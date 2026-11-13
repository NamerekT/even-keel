import { rmSync } from 'node:fs'
import { request } from 'node:http'
import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { serverFixture } from '../test/server.fixture.js'
import { EventHub } from './events.js'

describe('page transport', () => {
  let fixture: Awaited<ReturnType<typeof serverFixture>>
  afterEach(async () => {
    await fixture?.close()
    if (fixture) rmSync(fixture.publicDir, { recursive: true, force: true })
  })

  it('acknowledges commands without building state and retains failure notices', async () => {
    const getState = vi.fn(() => { throw new Error('state must not be built') })
    fixture = await serverFixture({ getState })
    const post = (project: string) => fetch(fixture.base + '/api/chain/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project }) })
    const success = await post('ABC')
    expect(success.status).toBe(200)
    expect(await success.json()).toEqual({ ok: true })
    const failure = await post('QQQ')
    expect(failure.status).toBe(400)
    expect((await failure.json()).notice).toBeDefined()
    expect(getState).not.toHaveBeenCalled()
  })

  it('serves tray data independently of the full state', async () => {
    const tray = { language: null, asking: 2, paused: 1 }
    const getState = vi.fn()
    fixture = await serverFixture({ getState, getTray: () => tray })
    const response = await fetch(fixture.base + '/api/tray')
    expect(await response.json()).toEqual(tray)
    expect(getState).not.toHaveBeenCalled()
  })

  it('acknowledges a command sent without the old ack header', async () => {
    const getState = vi.fn(() => ({ chain: [] }))
    fixture = await serverFixture({ getState })
    const response = await fetch(fixture.base + '/api/chain/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project: 'ABC' }) })
    expect(await response.json()).toEqual({ ok: true })
    expect(getState).not.toHaveBeenCalled()
  })

  it.each(['gzip', 'br, gzip;q=0.5', '*;q=0.5'])('compresses large JSON when accepting %s', async (encoding) => {
    const state = { text: 'large state '.repeat(10_000) }
    fixture = await serverFixture({ getState: () => state })
    const answer = await raw('/api/state', encoding)
    expect(answer.headers['content-encoding']).toBe('gzip')
    expect(answer.headers.vary).toBe('Accept-Encoding')
    expect(answer.body.length).toBeLessThan(2000)
    expect(JSON.parse(gunzipSync(answer.body).toString())).toEqual(state)
  })

  it.each(['identity', 'br', 'gzip;q=0, *;q=1'])('leaves unsupported or refused compression alone: %s', async (encoding) => {
    const state = { text: 'large state '.repeat(1000) }
    fixture = await serverFixture({ getState: () => state })
    const answer = await raw('/api/state', encoding)
    expect(answer.headers['content-encoding']).toBeUndefined()
    expect(JSON.parse(answer.body.toString())).toEqual(state)
  })

  it('does not compress small JSON', async () => {
    fixture = await serverFixture()
    const answer = await raw('/api/state', 'gzip')
    expect(answer.headers['content-encoding']).toBeUndefined()
  })

  it('flushes each compressed event, including patches and pings, and unsubscribes on disconnect', async () => {
    const hub = new EventHub({ state: { sessions: 'sessionId' } })
    let state: { sessions: unknown[]; language: string | null } = { sessions: [], language: null }
    fixture = await serverFixture({ hub, getState: () => state })
    const controller = new AbortController()
    const response = await fetch(fixture.base + '/api/events', { headers: { 'accept-encoding': 'gzip' }, signal: controller.signal })
    const reader = response.body!.getReader()
    const readEvent = async (event: string) => {
      let text = ''
      while (!text.includes('\n\n')) text += new TextDecoder().decode((await reader.read()).value)
      expect(text).toContain(`event: ${event}\n`)
      return text
    }
    try {
      expect(response.headers.get('content-encoding')).toBe('gzip')
      await readEvent('state')
      hub.broadcast('state', { sessions: [], language: 'ru' })
      expect(await readEvent('statePatch')).toContain('"language":"ru"')
      hub.broadcast('ping', { n: 1 })
      await readEvent('ping')
      state = { ...state, language: 'en' }
      const answer = await fetch(fixture.base + '/api/chain/start', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project: 'ABC' }),
      })
      expect(await answer.json()).toEqual({ ok: true })
      expect(await readEvent('statePatch')).toContain('"language":"en"')
    } finally {
      controller.abort()
      await reader.cancel().catch(() => {})
    }
    await vi.waitFor(() => expect(hub.size).toBe(0))
  })

  function raw(path: string, encoding: string) {
    return new Promise<{ headers: import('node:http').IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
      request(fixture.base + path, { headers: { 'accept-encoding': encoding } }, (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => resolve({ headers: response.headers, body: Buffer.concat(chunks) }))
        response.on('error', reject)
      }).on('error', reject).end()
    })
  }
})
