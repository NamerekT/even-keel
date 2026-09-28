import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EventHub } from './events.js'
import { createBatonServer, type AccountControl, type ChainControl } from './server.js'

describe('Baton HTTP server', () => {
  let hub: EventHub
  let publicDir: string
  let calls: unknown[][]
  let base: string
  let close: () => Promise<void>

  beforeEach(async () => {
    publicDir = mkdtempSync(join(tmpdir(), 'baton-public-'))
    writeFileSync(join(publicDir, 'index.html'), '<title>Baton</title>')
    hub = new EventHub()
    calls = []
    const record =
      (name: string) =>
      (...args: unknown[]) => {
        if (args[0] === 'QQQ') throw new Error('QQQ is not a configured project')
        calls.push([name, ...args])
      }
    const control: ChainControl = {
      start: record('start'),
      pause: record('pause'),
      resume: record('resume'),
      stop: record('stop'),
      dequeue: record('dequeue'),
      reorder: record('reorder'),
      requeue: record('requeue'),
      skip: record('skip'),
      unskip: record('unskip'),
      restart: record('restart'),
    }
    const account: AccountControl = {
      add: () => {
        if (calls.some(([name]) => name === 'add')) throw new Error('claude: a sign-in is already running')
        calls.push(['add'])
      },
      renew: record('renew'),
      switchTo: record('switch'),
      remove: async (key) => {
        await Promise.resolve()
        if (key === 'global') throw new Error('claude: the global account lives in ~/.claude and is not removed from here')
        calls.push(['remove', key])
      },
      code: record('code'),
      cancel: record('cancel'),
    }
    const server = createBatonServer({
      hub,
      publicDir,
      getState: () => ({ chain: [] }),
      control,
      account,
      launches: () => [{ task: 'ABC-1' }],
      sessionRecord: async (id) => {
        if (id === 'bad') throw new Error('sessions: bad is not a session id')
        return id === '0a1b2c3d' ? { sessionId: id } : undefined
      },
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    close = () => new Promise((resolve) => server.close(() => resolve()))
  })

  afterEach(async () => {
    await close()
  })

  it('serves the page at the root', async () => {
    const response = await fetch(base + '/')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/text\/html/)
    expect(await response.text()).toContain('Baton')
  })

  it('serves the state as JSON', async () => {
    const response = await fetch(base + '/api/state')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ chain: [] })
  })

  it('answers 404 for an unknown path and refuses to leave the public folder', async () => {
    expect((await fetch(base + '/nope.txt')).status).toBe(404)
    for (const escape of ['/..%2fpackage.json', '/..%5c..%5cpackage.json', '/%2e%2e/%2e%2e/package.json']) {
      expect((await fetch(base + escape)).status, escape).toBe(404)
    }
  })

  it('answers client routes with the page so a reload keeps the screen', async () => {
    for (const route of ['/p/ABC', '/p/ABC/', '/some/deep/route']) {
      const response = await fetch(base + route)
      expect(response.status, route).toBe(200)
      expect(response.headers.get('content-type'), route).toMatch(/text\/html/)
      expect(await response.text(), route).toContain('Baton')
    }
    expect((await fetch(base + '/assets/missing.js')).status).toBe(404)
    expect((await fetch(base + '/api/nope')).status).toBe(404)
  })

  it('tells how to build the client when the page is missing', async () => {
    rmSync(join(publicDir, 'index.html'))
    for (const route of ['/', '/p/ABC']) {
      const response = await fetch(base + route)
      expect(response.status, route).toBe(503)
      expect(await response.text(), route).toMatch(/npm run build/)
    }
  })

  it('streams the current state first and then broadcasts', async () => {
    const controller = new AbortController()
    const response = await fetch(base + '/api/events', { signal: controller.signal })
    expect(response.headers.get('content-type')).toMatch(/text\/event-stream/)

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let text = ''
    while (!text.includes('event: state')) text += decoder.decode((await reader.read()).value)

    hub.broadcast('ping', { n: 1 })
    while (!text.includes('event: ping')) text += decoder.decode((await reader.read()).value)

    expect(text).toContain('event: state\ndata: {"chain":[]}\n\n')
    expect(text).toContain('event: ping\ndata: {"n":1}\n\n')
    controller.abort()
  })

  const post = (path: string, body?: unknown) =>
    fetch(base + path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

  it('drives the chain through POST commands and answers with the state', async () => {
    const response = await post('/api/chain/start', { project: 'ABC' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ chain: [] })

    await post('/api/chain/pause')
    await post('/api/chain/resume')
    await post('/api/chain/stop')
    await post('/api/chain/dequeue', { project: 'XYZ' })
    await post('/api/chain/order', { project: 'ABC', order: ['ABC-2', 'ABC-1'] })
    await post('/api/chain/queue', { order: ['XYZ', 'OPS'] })
    await post('/api/chain/skip', { project: 'ABC', task: 'ABC-1' })
    await post('/api/chain/unskip', { project: 'ABC', task: 'ABC-1' })
    await post('/api/chain/restart', { project: 'ABC', task: 'ABC-1' })
    expect(calls).toEqual([
      ['start', 'ABC'],
      ['pause'],
      ['resume'],
      ['stop'],
      ['dequeue', 'XYZ'],
      ['reorder', 'ABC', ['ABC-2', 'ABC-1']],
      ['requeue', ['XYZ', 'OPS']],
      ['skip', 'ABC', 'ABC-1'],
      ['unskip', 'ABC', 'ABC-1'],
      ['restart', 'ABC', 'ABC-1'],
    ])
  })

  it('answers 400 with the reason for a refused or malformed command', async () => {
    const refused = await post('/api/chain/start', { project: 'QQQ' })
    expect(refused.status).toBe(400)
    expect(await refused.json()).toEqual({ error: 'QQQ is not a configured project' })

    expect((await post('/api/chain/start', {})).status).toBe(400)
    expect((await post('/api/chain/order', { project: 'ABC', order: [1] })).status).toBe(400)
    expect((await post('/api/chain/queue', { order: 'XYZ' })).status).toBe(400)
    expect((await post('/api/chain/skip', { project: 'ABC' })).status).toBe(400)
    expect((await fetch(base + '/api/chain/start', { method: 'POST', body: '{' })).status).toBe(400)
    expect((await post('/api/chain/nope')).status).toBe(404)
    expect(calls).toEqual([])
  })

  it('drives the Claude sign-in through POST commands', async () => {
    const response = await post('/api/account/add')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ chain: [] })

    await post('/api/account/code', { code: 'abc#def' })
    await post('/api/account/cancel')
    await post('/api/account/renew', { account: 'work' })
    expect(calls).toEqual([['add'], ['code', 'abc#def'], ['cancel'], ['renew', 'work']])

    const again = await post('/api/account/add')
    expect(again.status).toBe(400)
    expect(await again.json()).toEqual({ error: 'claude: a sign-in is already running' })
    expect((await post('/api/account/code', {})).status).toBe(400)
    expect((await post('/api/account/code', { code: '  ' })).status).toBe(400)
    expect((await post('/api/account/renew', {})).status).toBe(400)
    expect((await post('/api/account/nope')).status).toBe(404)
    expect((await post('/api/nope/start')).status).toBe(404)
  })

  it('switches and removes accounts, waiting for a removal to finish', async () => {
    expect((await post('/api/account/switch', { account: 'work' })).status).toBe(200)
    expect((await post('/api/account/remove', { account: 'old' })).status).toBe(200)
    expect(calls).toEqual([
      ['switch', 'work'],
      ['remove', 'old'],
    ])
    const refused = await post('/api/account/remove', { account: 'global' })
    expect(refused.status).toBe(400)
    expect(await refused.json()).toEqual({ error: 'claude: the global account lives in ~/.claude and is not removed from here' })
    expect((await post('/api/account/switch', { account: '' })).status).toBe(400)
  })

  it('serves the transcript summary of any session by its id', async () => {
    const found = await fetch(base + '/api/sessions/0a1b2c3d')
    expect(found.status).toBe(200)
    expect(await found.json()).toEqual({ sessionId: '0a1b2c3d' })
    expect((await fetch(base + '/api/sessions/ffffffff')).status).toBe(404)
    const refused = await fetch(base + '/api/sessions/bad')
    expect(refused.status).toBe(400)
    expect(await refused.json()).toEqual({ error: 'sessions: bad is not a session id' })
  })

  it('serves the launch journal', async () => {
    const response = await fetch(base + '/api/launches')
    expect(await response.json()).toEqual([{ task: 'ABC-1' }])
  })
})
