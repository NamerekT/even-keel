import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EventHub } from './events.js'
import { createEvenKeelServer, type AccountControl, type ChainControl } from './server.js'
import { textNotice } from './notice/notice.js'

const refusal = (text: string) => ({ error: text, notice: textNotice(text) })

describe('Even Keel HTTP server', () => {
  let hub: EventHub
  let publicDir: string
  let calls: unknown[][]
  let base: string
  let close: () => Promise<void>

  beforeEach(async () => {
    publicDir = mkdtempSync(join(tmpdir(), 'even-keel-public-'))
    writeFileSync(join(publicDir, 'index.html'), '<title>Even Keel</title>')
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
      resume: record('resume'),
      stop: record('stop'),
      dequeue: record('dequeue'),
      reorder: record('reorder'),
      requeue: record('requeue'),
      skip: record('skip'),
      unskip: record('unskip'),
      restart: record('restart'),
      dismiss: record('dismiss'),
      setUnattended: record('setUnattended'),
      setTrimTools: record('setTrimTools'),
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
    const server = createEvenKeelServer({
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
      transcript: async (id, after) => {
        if (id === 'bad') throw new Error('sessions: bad is not a session id')
        return id === '0a1b2c3d' ? [{ kind: 'prompt', text: 'ABC-1' }, { kind: 'text', text: 'On it.' }].slice(after) : undefined
      },
      checkpoint: async (id) =>
        id === '0a1b2c3d' ? { project: 'ABC', task: 'ABC-1', handoffs: 2, first: 193_000, source: 'calibrated' } : undefined,
      tools: async (project) => (project === 'ABC' ? { project } : undefined),
      tasks: {
        card: async (task) => {
          if (task === 'ABC-9') throw new Error('huly: issue ABC-9 not found')
          return task === 'ABC-1' ? ({ id: task } as never) : undefined
        },
        ready: async (task) => {
          if (task === 'ABC-9') throw new Error('huly: issue ABC-9 not found')
          calls.push(['ready', task])
        },
        file: async (task, file) => {
          if (task === 'ABC-9') throw new Error('huly: issue ABC-9 not found')
          if (task !== 'ABC-1') return undefined
          if (file === 'shot 1.png') return { type: 'image/png', size: 4, body: Readable.from([Buffer.from('PNG!')]) }
          if (file === 'page.html') return { type: 'text/html', size: 6, body: Readable.from([Buffer.from('<html>')]) }
          return undefined
        },
      },
      stats: {
        history: async (filter) => ({ state: 'off', reason: `history ${filter.scope} ${filter.account} ${filter.tz}` }),
        period: async (query) => ({ state: 'off', reason: `period ${query.from} ${query.to} ${query.projects?.join('+')}` }),
        task: async (task) => ({ state: 'error', error: `task ${task}` }),
        calibration: async (project, task) => ({ state: 'off', reason: `calibration ${project} ${task ?? 'none'}` }),
        checkpoints: async () => ({ state: 'off', reason: 'checkpoints' }),
        rules: async (query) => ({ state: 'off', reason: `rules ${query.projects?.join('+')} ${query.kinds?.join('+')}` }),
        ruleDiff: async (ids) => ({ state: 'off', reason: `diff ${ids.length}` }),
        compare: async (query) => ({ state: 'off', reason: `compare ${query.before} ${query.after} ${query.days}` }),
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
    expect(await response.text()).toContain('Even Keel')
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
      expect(await response.text(), route).toContain('Even Keel')
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

    await post('/api/chain/resume', { project: 'ABC' })
    await post('/api/chain/stop', { project: 'ABC' })
    await post('/api/chain/dequeue', { project: 'XYZ' })
    await post('/api/chain/order', { project: 'ABC', order: ['ABC-2', 'ABC-1'] })
    await post('/api/chain/queue', { order: ['XYZ', 'OPS'] })
    await post('/api/chain/skip', { project: 'ABC', task: 'ABC-1' })
    await post('/api/chain/unskip', { project: 'ABC', task: 'ABC-1' })
    await post('/api/chain/restart', { project: 'ABC', task: 'ABC-1' })
    await post('/api/chain/dismiss', { project: 'ABC', task: 'ABC-0' })
    await post('/api/chain/unattended', { on: true })
    await post('/api/chain/trim', { on: false })
    expect(calls).toEqual([
      ['start', 'ABC'],
      ['resume', 'ABC'],
      ['stop', 'ABC'],
      ['dequeue', 'XYZ'],
      ['reorder', 'ABC', ['ABC-2', 'ABC-1']],
      ['requeue', ['XYZ', 'OPS']],
      ['skip', 'ABC', 'ABC-1'],
      ['unskip', 'ABC', 'ABC-1'],
      ['restart', 'ABC', 'ABC-1'],
      ['dismiss', 'ABC', 'ABC-0'],
      ['setUnattended', true],
      ['setTrimTools', false],
    ])
  })

  it('serves what sessions of a project get, 404 for an unknown project', async () => {
    const response = await fetch(base + '/api/projects/ABC/tools')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ project: 'ABC' })
    expect((await fetch(base + '/api/projects/QQQ/tools')).status).toBe(404)
  })

  it('serves the card of a task, 404 when no tracker gives one', async () => {
    const response = await fetch(base + '/api/tasks/ABC-1')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: 'ABC-1' })
    expect((await fetch(base + '/api/tasks/ABC-2')).status).toBe(404)
    expect((await fetch(base + '/api/tasks/nope')).status).toBe(400)
    const failed = await fetch(base + '/api/tasks/ABC-9')
    expect(failed.status).toBe(400)
    expect(await failed.json()).toEqual(refusal('huly: issue ABC-9 not found'))
  })

  it('passes a file of a task through, 404 for a file the task does not have', async () => {
    const response = await fetch(base + '/api/tasks/ABC-1/files/shot%201.png')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('content-length')).toBe('4')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-disposition')).toBe('inline')
    expect(await response.text()).toBe('PNG!')
    expect((await fetch(base + '/api/tasks/ABC-1/files/other.png')).status).toBe(404)
    expect((await fetch(base + '/api/tasks/ABC-2/files/shot%201.png')).status).toBe(404)
    expect((await fetch(base + '/api/tasks/nope/files/shot%201.png')).status).toBe(400)
    expect((await fetch(base + '/api/tasks/ABC-9/files/shot%201.png')).status).toBe(400)
  })

  it('makes a file that is not a picture, video or PDF a download, so it never runs on the page origin', async () => {
    const response = await fetch(base + '/api/tasks/ABC-1/files/page.html')
    expect(response.headers.get('content-disposition')).toBe('attachment')
    expect(response.headers.get('content-security-policy')).toBe('sandbox')
  })

  it('moves a backlog task to Todo', async () => {
    expect((await post('/api/task/ready', { task: 'ABC-1' })).status).toBe(200)
    expect(calls).toEqual([['ready', 'ABC-1']])
    expect((await post('/api/task/ready', {})).status).toBe(400)
    expect((await post('/api/task/ready', { task: 'ABC-9' })).status).toBe(400)
  })

  it('answers 400 with the reason for a refused or malformed command', async () => {
    const refused = await post('/api/chain/start', { project: 'QQQ' })
    expect(refused.status).toBe(400)
    expect(await refused.json()).toEqual(refusal('QQQ is not a configured project'))

    expect((await post('/api/chain/start', {})).status).toBe(400)
    expect((await post('/api/chain/order', { project: 'ABC', order: [1] })).status).toBe(400)
    expect((await post('/api/chain/queue', { order: 'XYZ' })).status).toBe(400)
    expect((await post('/api/chain/skip', { project: 'ABC' })).status).toBe(400)
    expect((await post('/api/chain/unattended', { on: 'yes' })).status).toBe(400)
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
    expect(await again.json()).toEqual(refusal('claude: a sign-in is already running'))
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
    expect(await refused.json()).toEqual(refusal('claude: the global account lives in ~/.claude and is not removed from here'))
    expect((await post('/api/account/switch', { account: '' })).status).toBe(400)
  })

  it('serves the transcript summary of any session by its id', async () => {
    const found = await fetch(base + '/api/sessions/0a1b2c3d')
    expect(found.status).toBe(200)
    expect(await found.json()).toEqual({ sessionId: '0a1b2c3d' })
    expect((await fetch(base + '/api/sessions/ffffffff')).status).toBe(404)
    const refused = await fetch(base + '/api/sessions/bad')
    expect(refused.status).toBe(400)
    expect(await refused.json()).toEqual(refusal('sessions: bad is not a session id'))
  })

  it('serves the whole transcript of any session by its id', async () => {
    const found = await fetch(base + '/api/sessions/0a1b2c3d/transcript')
    expect(found.status).toBe(200)
    expect(await found.json()).toEqual([
      { kind: 'prompt', text: 'ABC-1' },
      { kind: 'text', text: 'On it.' },
    ])
    expect(await (await fetch(base + '/api/sessions/0a1b2c3d/transcript?after=1')).json()).toEqual([{ kind: 'text', text: 'On it.' }])
    expect(await (await fetch(base + '/api/sessions/0a1b2c3d/transcript?after=junk')).json()).toHaveLength(2)
    expect((await fetch(base + '/api/sessions/ffffffff/transcript')).status).toBe(404)
    expect((await fetch(base + '/api/sessions/bad/transcript')).status).toBe(400)
  })

  it('serves the Tally history, a period and a task', async () => {
    const history = await fetch(base + '/api/stats/history?scope=chain&account=work&tz=Europe/Berlin')
    expect(await history.json()).toEqual({ state: 'off', reason: 'history chain work Europe/Berlin' })
    const period = await fetch(base + '/api/stats/period?from=2026-09-04&to=2026-10-03&projects=ABC,Example')
    expect(await period.json()).toEqual({ state: 'off', reason: 'period 2026-09-04 2026-10-03 ABC+Example' })
    const task = await fetch(base + '/api/stats/task/ABC-12')
    expect(await task.json()).toEqual({ state: 'error', error: 'task ABC-12' })
    expect((await fetch(base + '/api/stats/ABC')).status).toBe(404)
  })

  it('serves the estimate calibration of any project key, for a task or for a new one', async () => {
    const forTask = await fetch(base + '/api/projects/XYZ/calibration?task=XYZ-4')
    expect(await forTask.json()).toEqual({ state: 'off', reason: 'calibration XYZ XYZ-4' })
    const fresh = await fetch(base + '/api/projects/ABC/calibration')
    expect(await fresh.json()).toEqual({ state: 'off', reason: 'calibration ABC none' })
    expect((await fetch(base + '/api/projects/ABC/calibration?task=4')).status).toBe(400)
    expect((await fetch(base + '/api/projects/a-b/calibration')).status).toBe(404)
  })

  it('serves the checkpoint threshold of a chain session to the hook, and of the projects to the page', async () => {
    const known = await fetch(base + '/api/sessions/0a1b2c3d/checkpoint')
    expect(await known.json()).toEqual({ project: 'ABC', task: 'ABC-1', handoffs: 2, first: 193_000, source: 'calibrated' })
    expect((await fetch(base + '/api/sessions/manual/checkpoint')).status).toBe(404)
    const page = await fetch(base + '/api/stats/checkpoints')
    expect(await page.json()).toEqual({ state: 'off', reason: 'checkpoints' })
  })

  it('serves the rule marks, a diff and a before and after comparison', async () => {
    const rules = await fetch(base + '/api/stats/rules?projects=ABC&kinds=skill,memory')
    expect(await rules.json()).toEqual({ state: 'off', reason: 'rules ABC skill+memory' })
    const id = 'f'.repeat(40)
    const diff = await fetch(base + `/api/stats/rules/diff?changes=${id},${id}`)
    expect(await diff.json()).toEqual({ state: 'off', reason: 'diff 2' })
    const compare = await fetch(base + '/api/stats/rules/compare?before=2026-09-10T10:00:00Z&after=2026-09-11T10:00:00Z&days=3')
    expect(await compare.json()).toEqual({ state: 'off', reason: 'compare 2026-09-10T10:00:00.000Z 2026-09-11T10:00:00.000Z 3' })
    expect((await fetch(base + '/api/stats/rules?kinds=prompt')).status).toBe(400)
    expect((await fetch(base + '/api/stats/rules/diff?changes=x')).status).toBe(400)
    expect((await fetch(base + '/api/stats/rules/compare?before=2026-09-10')).status).toBe(400)
  })

  it('refuses a malformed statistics request', async () => {
    const backwards = await fetch(base + '/api/stats/period?from=2026-10-03&to=2026-09-04')
    expect(backwards.status).toBe(400)
    expect(await backwards.json()).toEqual(refusal('from must not be after to'))
    expect((await fetch(base + '/api/stats/period?from=2026-02-30&to=2026-03-01')).status).toBe(400)
    expect((await fetch(base + '/api/stats/history?tz=Europe/Berlin%27;drop')).status).toBe(400)
    expect((await fetch(base + '/api/stats/task/abc')).status).toBe(400)
  })

  it('serves the launch journal', async () => {
    const response = await fetch(base + '/api/launches')
    expect(await response.json()).toEqual([{ task: 'ABC-1' }])
  })
})
