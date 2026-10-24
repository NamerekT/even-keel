import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EventHub } from './events.js'
import { guardHosts } from './guard.js'
import { createEvenKeelServer, type AccountControl, type ChainControl } from './server.js'
import { textNotice } from './notice/notice.js'

const refusal = (text: string) => ({ error: text, notice: textNotice(text) })
const STANDARD = { doc: 'docs/design.md', files: ['web/**/*.tsx'], except: ['**/*.test.*'], shots: true }

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
      stopAfter: record('stopAfter'),
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
      add: (agent) => {
        if (calls.some(([name]) => name === 'add')) throw new Error('claude: a sign-in is already running')
        calls.push(['add', agent])
      },
      addApiKey: async (...args) => {
        record('api')(...args)
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
      sessions: {
        answer: async (request) => {
          calls.push(['answer', { ...request, files: request.files.map((file) => ({ name: file.name, text: Buffer.from(file.data).toString('utf8') })) }])
        },
        dismissMail: record('dismissMail'),
      },
      settings: {
        save: record('settings'),
        saveShared: record('shared'),
        check: async (draft) => {
          calls.push(['check', draft])
          return { repo: { root: draft.repo, current: 'main', notice: null }, entry: null, tracker: null, trusted: true, platform: 'win32' }
        },
        add: record('add'),
        remove: record('removeProject'),
        dismissUpdate: record('dismiss'),
        muteUpdates: record('mute'),
        installUpdate: async () => record('installUpdate')(),
        revertUpdate: async () => record('revertUpdate')(),
        closeUpdateResult: record('closeUpdateResult'),
      },
      packages: {
        install: async (name) => record('install')(name),
        update: async (name) => record('update')(name),
        remove: record('removePackage'),
        addPlugin: record('addPlugin'),
        addServer: record('addServer'),
        importRepo: record('import'),
        choose: record('choose'),
        setDefault: record('default'),
        setSetting: record('setting'),
        setKey: record('key'),
      },
      secrets: { set: record('secretSet'), remove: record('secretRemove'), update: record('secretUpdate') },
      tally: { set: async (mode, server) => record('tally')(mode, server) },
      launches: () => [{ task: 'ABC-1' }],
      sessionRecord: async (id) => {
        if (id === 'bad') throw new Error('sessions: bad is not a session id')
        return id === '0a1b2c3d' ? { sessionId: id } : undefined
      },
      transcript: async (id, after) => {
        if (id === 'bad') throw new Error('sessions: bad is not a session id')
        return id === '0a1b2c3d' ? [{ kind: 'prompt', text: 'ABC-1' }, { kind: 'text', text: 'On it.' }].slice(after) : undefined
      },
      transcriptImage: async (id, tool, index) => {
        if (id === 'bad') throw new Error('sessions: bad is not a session id')
        return id === '0a1b2c3d' && tool === 'toolu_1' && index === 0 ? { type: 'image/png', size: 4, body: Readable.from([Buffer.from('PNG!')]) } : undefined
      },
      inboxFile: async (id, name) =>
        id === '0a1b2c3d' && name === 'order 1.png' ? { type: 'image/png', size: 4, body: Readable.from([Buffer.from('PNG!')]) } : undefined,
      sharedFile: async (id, tool, index) => {
        if (id === 'bad') throw new Error('sessions: bad is not a session id')
        return id === '0a1b2c3d' && tool === 'toolu_2' && index === 0
          ? { type: 'text/markdown; charset=utf-8', size: 7, body: Readable.from([Buffer.from('# Audit')]) }
          : undefined
      },
      checkpoint: async (id) =>
        id === '0a1b2c3d' ? { project: 'ABC', task: 'ABC-1', handoffs: 2, first: 193_000, source: 'calibrated', late: 212_000, hard: 237_000 } : undefined,
      mergeCheck: (id) => (id === 'chain-session' ? { commands: ['npm test'], branch: 'master', standards: [STANDARD] } : undefined),
      mail: (id, event) => (id !== 'chain-session' ? undefined : event === 'PostToolUse' ? `mail on ${event}` : null),
      tools: async (project) => (project === 'ABC' ? { project } : undefined),
      vocabulary: async (id) => {
        if (id === 'down') throw new Error('github: HTTP 502')
        return id === '0b1c2d3e' ? { statuses: [{ name: 'Open', category: 'ToDo' }], labels: ['bug'] } : undefined
      },
      models: async (key) => (key === 'opencode' ? { models: ['opencode/big-pickle'], complete: true } : null),
      tasks: {
        card: async (task) => {
          if (task === 'ABC-9') throw new Error('huly: issue ABC-9 not found')
          return task === 'ABC-1' ? ({ id: task } as never) : undefined
        },
        ready: async (task) => {
          if (task === 'ABC-9') throw new Error('huly: issue ABC-9 not found')
          calls.push(['ready', task])
        },
        moveMilestone: async (task, milestone) => {
          calls.push(['milestone', task, milestone])
        },
        refresh: async (project) => {
          calls.push(['refresh', project])
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
        spend: async (tz) => ({ state: 'off', reason: `spend ${tz}` }),
        tokens: async (tz) => ({ state: 'off', reason: `tokens ${tz}` }),
        rules: async (query) => ({ state: 'off', reason: `rules ${query.projects?.join('+')} ${query.kinds?.join('+')}` }),
        ruleDiff: async (ids) => ({ state: 'off', reason: `diff ${ids.length}` }),
        compare: async (query) => ({ state: 'off', reason: `compare ${query.before} ${query.after} ${query.days}` }),
      },
      guard: () => ({ hosts: guardHosts('127.0.0.1', []), token: null }),
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    close = () => new Promise((resolve) => server.close(() => resolve()))
  })

  afterEach(async () => {
    await close()
    rmSync(publicDir, { recursive: true, force: true })
  })

  it('refuses a foreign Host and a foreign Origin before any route', async () => {
    const send = (method: string, path: string, headers: Record<string, string>) =>
      new Promise<number>((resolve, reject) => {
        const { hostname, port } = new URL(base)
        request({ hostname, port, method, path, headers }, (response) => {
          response.resume()
          resolve(response.statusCode ?? 0)
        })
          .on('error', reject)
          .end(method === 'POST' ? JSON.stringify({ project: 'ABC' }) : undefined)
      })
    expect(await send('GET', '/api/state', { host: 'evil.example.net:4747' })).toBe(403)
    expect(await send('POST', '/api/chain/start', { origin: 'https://evil.example.net' })).toBe(403)
    expect(calls).toEqual([])
    expect(await send('POST', '/api/chain/start', { host: 'localhost:4747', origin: 'http://localhost:4747' })).toBe(200)
    expect(calls).toEqual([['start', 'ABC']])
  })

  it('serves the page at the root', async () => {
    const response = await fetch(base + '/')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/text\/html/)
    expect(await response.text()).toContain('Even Keel')
  })

  it('passes an answer with its files on, past the usual body limit', async () => {
    const big = Buffer.alloc(100 * 1024, 'a').toString('base64')
    const body = {
      project: 'ABC',
      task: 'ABC-1',
      sessionId: '0a1b2c3d',
      ask: 'toolu_1',
      answers: { 'Which color?': 'Blue' },
      text: 'Also this',
      files: [{ name: 'a.txt', data: Buffer.from('hello').toString('base64') }, { name: 'big.txt', data: big }],
    }
    const response = await fetch(base + '/api/session/answer', { method: 'POST', body: JSON.stringify(body) })
    expect(response.status).toBe(200)
    const [, request] = calls.find(([name]) => name === 'answer')! as [string, { files: { name: string; text: string }[] }]
    expect(request).toMatchObject({ project: 'ABC', task: 'ABC-1', sessionId: '0a1b2c3d', ask: 'toolu_1', answers: { 'Which color?': 'Blue' }, text: 'Also this' })
    expect(request.files[0]).toEqual({ name: 'a.txt', text: 'hello' })
    expect(request.files[1]?.text.length).toBe(100 * 1024)
  })

  it('refuses an answer without its session', async () => {
    const response = await fetch(base + '/api/session/answer', { method: 'POST', body: JSON.stringify({ project: 'ABC', task: 'ABC-1', ask: null }) })
    expect(response.status).toBe(400)
    expect((await response.json()).notice).toMatchObject({ code: 'request.required', params: { field: 'sessionId' } })
  })

  const chain = { active: null, terminal: ['Done'], requiredLabels: [], excludedLabels: ['Manual'], requiredMilestones: [], excludedMilestones: [] }
  const form = { name: 'Web shop', branch: 'master', repo: 'C:\\abc', tracker: 'github', trackerProject: 'octo-org/abc', slot: 2, color: 3, brief: false, chain, provider: 'codex', models: { codex: 'gpt-6.1-sol' }, accounts: {}, modelLabels: true, pullRequests: false, intakeLabel: null, mergeInto: null, remoteProfiles: { forgejo: 'own' } }

  it('passes the settings of a project on with the values the form started from', async () => {
    const ci = { guard: false, kinds: ['github'], waitMinutes: 15, recheckMain: false, fixTask: true }
    const settings = {
      ...{ prompt: 'Run npm test.', beforeStart: ['npm ci'], check: ['npm test'], afterGreen: ['npm run build'], ci, fillMilestone: true, changelog: 'docs/CHANGELOG.md', standards: [STANDARD], ...form },
      ...{ promptLanguage: 'ru', cacheTtl: '1h', checkpointTokens: 180_000, checkpointShares: { first: 60, late: 85, hard: 95 } },
      own: { 'ci.guard': false, cacheTtl: '1h', 'stats.checkpointShares.first': 60 },
      ownRules: [],
    }
    const started = { ...settings, prompt: null, slot: 0, own: {} }
    const response = await fetch(base + '/api/project/settings', { method: 'POST', body: JSON.stringify({ project: 'ABC', ...settings, base: started }) })
    expect(response.status).toBe(200)
    expect(calls).toContainEqual(['settings', 'ABC', settings, started])

    const unknown = await fetch(base + '/api/project/settings', { method: 'POST', body: JSON.stringify({ project: 'ABC', ...settings, own: { parallel: 2 }, base: started }) })
    expect(unknown.status).toBe(400)
    expect((await unknown.json()).notice).toMatchObject({ code: 'request.required', params: { field: 'own' } })

    const missing = await fetch(base + '/api/project/settings', { method: 'POST', body: JSON.stringify({ project: 'ABC', ...settings }) })
    expect(missing.status).toBe(400)
    expect((await missing.json()).notice).toMatchObject({ code: 'request.required', params: { field: 'base' } })
  })

  it('checks and adds the wizard project, removes a project, and refuses a draft of a wrong shape', async () => {
    const draft = { repo: 'D:\\new', branch: '', key: 'NEW', name: '', tracker: 'huly', trackerProject: '', profile: null, slot: 0 }
    const check = await fetch(base + '/api/project/check', { method: 'POST', body: JSON.stringify(draft) })
    expect(check.status).toBe(200)
    expect(await check.json()).toEqual({ repo: { root: 'D:\\new', current: 'main', notice: null }, entry: null, tracker: null, trusted: true, platform: 'win32' })

    expect((await fetch(base + '/api/project/add', { method: 'POST', body: JSON.stringify(draft) })).status).toBe(200)
    expect((await fetch(base + '/api/project/remove', { method: 'POST', body: JSON.stringify({ project: 'ABC' }) })).status).toBe(200)
    // A page open since before the milestones and the agent fields sends neither.
    expect(calls).toEqual([
      ['check', { ...draft, milestones: [], provider: null }],
      ['add', { ...draft, milestones: [], provider: null }],
      ['removeProject', 'ABC'],
    ])

    for (const [field, change] of [['slot', { slot: -1 }], ['key', { key: 5 }], ['branch', { branch: undefined }], ['milestones', { milestones: ['v1', 2] }]] as const) {
      const response = await fetch(base + '/api/project/check', { method: 'POST', body: JSON.stringify({ ...draft, ...change }) })
      expect(response.status).toBe(400)
      expect((await response.json()).notice).toMatchObject({ code: 'request.required', params: { field } })
    }
  })

  it('refuses project settings of a wrong shape', async () => {
    const ci = { guard: true, kinds: [], waitMinutes: null, recheckMain: true, fixTask: false }
    const bad = [
      ['branch', { branch: 1 }],
      ['slot', { slot: -1 }],
      ['slot', { slot: true }],
      ['color', { color: 'red' }],
      ['trackerProject', { trackerProject: 5 }],
      ['name', { name: 5 }],
      ['brief', { brief: 'no' }],
      ['provider', { provider: 5 }],
      ['models', { models: { codex: 5 } }],
      ['accounts', { accounts: null }],
      ['modelLabels', { modelLabels: 'yes' }],
      ['chain', { chain: { ...chain, active: 'Todo' } }],
    ] as const
    for (const [field, change] of bad) {
      const body = { project: 'ABC', prompt: '', beforeStart: [], check: [], afterGreen: [], ci, fillMilestone: false, changelog: 'CHANGELOG.md', ...form, ...change }
      const response = await fetch(base + '/api/project/settings', { method: 'POST', body: JSON.stringify(body) })
      expect(response.status).toBe(400)
      expect((await response.json()).notice).toMatchObject({ code: 'request.required', params: { field } })
    }
  })

  it('passes the shared settings on and refuses a wrong shape', async () => {
    const shared = {
      parallel: 2,
      brief: true,
      chain,
      provider: 'claude',
      models: { claude: 'opus' },
      accounts: { claude: 'global', codex: 'codex' },
      execution: { codex: 'sandbox' },
      cli: { claude: 'checked', codex: 'system' },
      modelLabels: false,
      modelPrompts: { haiku: 'Be brief.' },
      prompt: '# Rules\n\n- Answer in English.',
      language: null,
      promptLanguage: 'en',
      hiddenSkills: ['dataviz'],
      cacheTtl: '1h',
      allowedHosts: [],
      context: { window: 600_000, warn: 50, danger: 80 },
      stats: { compare: { minTasks: 5, minSessions: 10, days: 7 }, moves: {}, otherBelow: 0, checkpointTokens: null, checkpointShares: { first: 70, late: 85, hard: 95 } },
      updates: { check: true, notify: false },
      ci: { guard: true, kinds: ['github'], waitMinutes: 15, recheckMain: false, fixTask: true },
      fillMilestone: true,
    }
    const started = { ...shared, parallel: 1 }
    const response = await fetch(base + '/api/settings', { method: 'POST', body: JSON.stringify({ ...shared, base: started }) })
    expect(response.status).toBe(200)
    expect(calls).toContainEqual(['shared', shared, started])

    const refusals = [
      ['parallel', { parallel: '2' }],
      ['modelPrompts', { modelPrompts: { haiku: 1 } }],
      ['prompt', { prompt: 1 }],
      ['execution', { execution: { codex: true } }],
      ['cli', { cli: 'checked' }],
      ['modelLabels', { modelLabels: null }],
      ['stats', { stats: { ...shared.stats, moves: [] } }],
      ['stats', { stats: { ...shared.stats, checkpointShares: { first: '70', late: 85, hard: 95 } } }],
      ['updates', { updates: { check: 'yes', notify: true } }],
    ] as const
    for (const [field, change] of refusals) {
      const refused = await fetch(base + '/api/settings', { method: 'POST', body: JSON.stringify({ ...shared, ...change }) })
      expect(refused.status).toBe(400)
      expect((await refused.json()).notice).toMatchObject({ code: 'request.required', params: { field } })
    }
  })

  it('passes on the toast buttons: closing one version and turning the toasts off', async () => {
    expect((await fetch(base + '/api/updates/dismiss', { method: 'POST', body: JSON.stringify({ version: '0.2.0' }) })).status).toBe(200)
    expect((await fetch(base + '/api/updates/mute', { method: 'POST', body: '{}' })).status).toBe(200)
    expect(calls).toContainEqual(['dismiss', '0.2.0'])
    expect(calls).toContainEqual(['mute'])
    const refused = await fetch(base + '/api/updates/dismiss', { method: 'POST', body: '{}' })
    expect(refused.status).toBe(400)
    expect((await refused.json()).notice).toMatchObject({ code: 'request.required', params: { field: 'version' } })
  })

  it('passes on the update window: update, revert and closing the result', async () => {
    for (const command of ['install', 'revert', 'seen']) {
      expect((await fetch(base + `/api/updates/${command}`, { method: 'POST', body: '{}' })).status).toBe(200)
    }
    expect(calls).toEqual(expect.arrayContaining([['installUpdate'], ['revertUpdate'], ['closeUpdateResult']]))
  })

  it('refuses settings without the milestone switch', async () => {
    const body = {
      project: 'ABC',
      prompt: '',
      beforeStart: [],
      check: [],
      afterGreen: [],
      ci: { guard: true, kinds: [], waitMinutes: null, recheckMain: true, fixTask: false },
      pullRequests: false,
      fillMilestone: 'yes',
    }
    const response = await fetch(base + '/api/project/settings', { method: 'POST', body: JSON.stringify(body) })
    expect(response.status).toBe(400)
    expect((await response.json()).notice).toMatchObject({ code: 'request.required', params: { field: 'fillMilestone' } })
  })

  it('refuses CI settings with an unknown CI, a wait that is not whole minutes or a missing switch', async () => {
    const bad = [
      undefined,
      { guard: true, kinds: ['jenkins'], waitMinutes: null, recheckMain: true, fixTask: false },
      { guard: true, kinds: [], waitMinutes: -5, recheckMain: true, fixTask: false },
      { guard: true, kinds: [], waitMinutes: 1.5, recheckMain: true, fixTask: false },
      { guard: true, kinds: [], waitMinutes: null, fixTask: false },
      { guard: true, kinds: [], waitMinutes: null, recheckMain: true },
      { kinds: [], waitMinutes: null, recheckMain: true, fixTask: false },
    ]
    for (const ci of bad) {
      const body = { project: 'ABC', prompt: '', beforeStart: [], check: [], afterGreen: [], ci }
      const response = await fetch(base + '/api/project/settings', { method: 'POST', body: JSON.stringify(body) })
      expect(response.status).toBe(400)
      expect((await response.json()).notice).toMatchObject({ code: 'request.required', params: { field: 'ci' } })
    }
  })

  it('refuses settings whose commands are not a list of strings', async () => {
    const cases = [
      ['beforeStart', { beforeStart: 'npm ci', check: [], afterGreen: [] }],
      ['check', { beforeStart: [], check: [1], afterGreen: [] }],
      ['afterGreen', { beforeStart: [], check: [] }],
    ] as const
    for (const [field, lists] of cases) {
      const body = { project: 'ABC', prompt: '', ...lists, ci: { guard: true, kinds: [], waitMinutes: null, recheckMain: true, fixTask: false } }
      const response = await fetch(base + '/api/project/settings', { method: 'POST', body: JSON.stringify(body) })
      expect(response.status).toBe(400)
      expect((await response.json()).notice).toMatchObject({ code: 'request.required', params: { field } })
    }
  })

  it('gives the merge hook the check commands and the main branch of a chain session and 404 for any other', async () => {
    const found = await fetch(base + '/api/sessions/chain-session/check')
    expect(found.status).toBe(200)
    expect(await found.json()).toEqual({ commands: ['npm test'], branch: 'master', standards: [STANDARD] })
    expect((await fetch(base + '/api/sessions/other/check')).status).toBe(404)
  })

  it('gives the standards hook the standards of a chain session and 404 for any other', async () => {
    const found = await fetch(base + '/api/sessions/chain-session/standards')
    expect(found.status).toBe(200)
    expect(await found.json()).toEqual({ standards: [STANDARD] })
    expect((await fetch(base + '/api/sessions/other/standards')).status).toBe(404)
  })

  it('gives the mailbox hook what waits for a chain session on its event and 404 for any other', async () => {
    const post = (id: string, body: unknown) => fetch(base + `/api/sessions/${id}/mail`, { method: 'POST', body: JSON.stringify(body) })
    const found = await post('chain-session', { event: 'PostToolUse' })
    expect(found.status).toBe(200)
    expect(await found.json()).toEqual({ message: 'mail on PostToolUse' })
    expect(await (await post('chain-session', { event: 'Stop' })).json()).toEqual({ message: null })
    expect((await post('other', { event: 'Stop' })).status).toBe(404)
    const bad = await post('chain-session', { event: 'resume' })
    expect(bad.status).toBe(400)
    expect((await bad.json()).notice).toMatchObject({ code: 'request.required', params: { field: 'event' } })
  })

  it('dismisses the returned messages of a session', async () => {
    const response = await fetch(base + '/api/session/mail/dismiss', { method: 'POST', body: JSON.stringify({ sessionId: '0a1b2c3d' }) })
    expect(response.status).toBe(200)
    expect(calls).toContainEqual(['dismissMail', '0a1b2c3d'])
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
    await post('/api/chain/stopAfter', { project: 'ABC', on: true })
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
      ['stopAfter', 'ABC', true],
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

  it("serves the tracker's statuses and labels of a project by its id, 404 when the tracker gives none", async () => {
    const response = await fetch(base + '/api/projects/0b1c2d3e/vocabulary')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ statuses: [{ name: 'Open', category: 'ToDo' }], labels: ['bug'] })
    expect((await fetch(base + '/api/projects/QQQ/vocabulary')).status).toBe(404)
    const failed = await fetch(base + '/api/projects/down/vocabulary')
    expect(failed.status).toBe(400)
    expect(await failed.json()).toEqual(refusal('github: HTTP 502'))
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

  it('moves a task into a milestone or out of any, and reads a project out of turn', async () => {
    expect((await post('/api/task/milestone', { task: 'ABC-1', milestone: 'm-1' })).status).toBe(200)
    expect((await post('/api/task/milestone', { task: 'ABC-1', milestone: null })).status).toBe(200)
    expect((await post('/api/task/milestone', { task: 'ABC-1' })).status).toBe(400)
    expect((await post('/api/chain/refresh', { project: 'ABC' })).status).toBe(200)
    expect(calls).toEqual([
      ['milestone', 'ABC-1', 'm-1'],
      ['milestone', 'ABC-1', null],
      ['refresh', 'ABC'],
    ])
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
    expect(calls).toEqual([['add', 'claude'], ['code', 'abc#def'], ['cancel'], ['renew', 'work']])

    const again = await post('/api/account/add', { agent: 'codex' })
    expect(again.status).toBe(400)
    expect(await again.json()).toEqual(refusal('claude: a sign-in is already running'))
    expect((await post('/api/account/code', {})).status).toBe(400)
    expect((await post('/api/account/code', { code: '  ' })).status).toBe(400)
    expect((await post('/api/account/renew', {})).status).toBe(400)
    expect((await post('/api/account/nope')).status).toBe(404)
  })

  it('drives the packages through POST commands, a project optional where the change may be for every project', async () => {
    await post('/api/packages/install', { name: 'huly@even-keel' })
    await post('/api/packages/update', { name: 'huly@even-keel' })
    await post('/api/packages/remove', { name: 'db' })
    await post('/api/packages/plugin', { plugin: 'huly', marketplace: 'even-keel', project: 'ABC' })
    await post('/api/packages/server', { name: 'db', server: { command: 'db-mcp' }, project: 'ABC' })
    await post('/api/packages/server', { name: 'web', server: { url: 'https://mcp.example.com' } })
    await post('/api/packages/import', { project: 'ABC' })
    await post('/api/packages/project', { project: 'ABC', name: 'db', choice: 'off' })
    await post('/api/packages/project', { project: 'ABC', name: 'db', choice: null })
    await post('/api/packages/default', { name: 'db', on: true })
    await post('/api/packages/setting', { name: 'huly@even-keel', key: 'TOOLSETS', value: 'issues', project: 'ABC' })
    await post('/api/packages/setting', { name: 'huly@even-keel', key: 'TOOLSETS', value: null })
    await post('/api/packages/key', { name: 'GITHUB_TOKEN', value: 'token-1' })
    expect(calls).toEqual([
      ['install', 'huly@even-keel'],
      ['update', 'huly@even-keel'],
      ['removePackage', 'db'],
      ['addPlugin', 'huly', 'even-keel', 'ABC'],
      ['addServer', 'db', { command: 'db-mcp' }, 'ABC'],
      ['addServer', 'web', { url: 'https://mcp.example.com' }, undefined],
      ['import', 'ABC'],
      ['choose', 'ABC', 'db', 'off'],
      ['choose', 'ABC', 'db', null],
      ['default', 'db', true],
      ['setting', 'huly@even-keel', 'TOOLSETS', 'issues', 'ABC'],
      ['setting', 'huly@even-keel', 'TOOLSETS', null, undefined],
      ['key', 'GITHUB_TOKEN', 'token-1'],
    ])
  })

  it('refuses a packages command of a wrong shape', async () => {
    expect((await post('/api/packages/install', {})).status).toBe(400)
    expect((await post('/api/packages/server', { name: 'db', server: 'db-mcp' })).status).toBe(400)
    expect((await post('/api/packages/project', { project: 'ABC', name: 'db', choice: 'maybe' })).status).toBe(400)
    expect((await post('/api/packages/default', { name: 'db' })).status).toBe(400)
    expect((await post('/api/packages/setting', { name: 'db', key: 'A', value: 1 })).status).toBe(400)
    expect((await post('/api/packages/key', { name: 'GITHUB_TOKEN' })).status).toBe(400)
    expect(calls).toEqual([])
  })

  it('writes and removes one credential at a time, and answers without its value', async () => {
    const written = await post('/api/secrets/set', { name: 'HULY_PASSWORD', value: 'hunter2-secret' })
    expect(await written.text()).not.toContain('hunter2')
    await post('/api/secrets/remove', { name: 'HULY_PASSWORD' })
    expect(calls).toEqual([
      ['secretSet', 'HULY_PASSWORD', 'hunter2-secret'],
      ['secretRemove', 'HULY_PASSWORD'],
    ])
    expect((await post('/api/secrets/set', { name: 'HULY_PASSWORD' })).status).toBe(400)
    expect((await post('/api/secrets/remove', {})).status).toBe(400)
  })

  it('writes several credentials at once, null removing one', async () => {
    await post('/api/secrets/update', { values: { TALLY_LLM_URL: 'https://llm.example.com', TALLY_LLM_MODEL: null } })
    expect(calls).toEqual([['secretUpdate', { TALLY_LLM_URL: 'https://llm.example.com', TALLY_LLM_MODEL: null }]])
    expect((await post('/api/secrets/update', {})).status).toBe(400)
    expect((await post('/api/secrets/update', { values: { TALLY_LLM_URL: 1 } })).status).toBe(400)
  })

  it('sets where the stats go, with the fields of the own Postgres or without', async () => {
    const server = { host: 'db.example.com', port: '', name: 'tally', readerPassword: 'read-secret', writerPassword: '' }
    expect(await (await post('/api/stats/tally', { mode: 'server', server })).text()).not.toContain('read-secret')
    await post('/api/stats/tally', { mode: 'off' })
    await post('/api/stats/tally', { mode: 'server' })
    expect(calls).toEqual([
      ['tally', 'server', server],
      ['tally', 'off', null],
      ['tally', 'server', null],
    ])
    expect((await post('/api/stats/tally', { mode: 'everywhere' })).status).toBe(400)
    expect((await post('/api/stats/tally', { mode: 'server', server: { host: 'db.example.com' } })).status).toBe(400)
  })

  it('adds an account of the agent the page asks for', async () => {
    await post('/api/account/add', { agent: 'codex' })
    expect(calls).toEqual([['add', 'codex']])
    expect((await post('/api/account/add', { agent: 7 })).status).toBe(400)
  })

  it('adds an API account by a key, the name optional', async () => {
    expect((await post('/api/account/api', { name: 'work', key: 'sk-ant-fake' })).status).toBe(200)
    expect((await post('/api/account/api', { key: 'sk-ant-fake' })).status).toBe(200)
    expect((await post('/api/account/api', { name: 'work' })).status).toBe(400)
    expect((await post('/api/account/api', { name: 'openai', key: 'sk-proj-fake', agent: 'codex' })).status).toBe(200)
    expect((await post('/api/account/api', { key: 'sk-proj-fake', agent: 7 })).status).toBe(400)
    expect(calls).toStrictEqual([
      ['api', 'work', 'sk-ant-fake', 'claude'],
      ['api', '', 'sk-ant-fake', 'claude'],
      ['api', 'openai', 'sk-proj-fake', 'codex'],
    ])
    expect((await post('/api/account/transport', { account: 'work', transport: 'sdk' })).status).toBe(404)
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

  it('serves a picture of a tool result and a file the user sent, by the session', async () => {
    const image = await fetch(base + '/api/sessions/0a1b2c3d/images/toolu_1/0')
    expect(image.status).toBe(200)
    expect(image.headers.get('content-type')).toBe('image/png')
    expect(await image.text()).toBe('PNG!')
    expect((await fetch(base + '/api/sessions/0a1b2c3d/images/toolu_1/1')).status).toBe(404)
    expect((await fetch(base + '/api/sessions/0a1b2c3d/images/toolu_1/x')).status).toBe(404)
    expect((await fetch(base + '/api/sessions/bad/images/toolu_1/0')).status).toBe(400)

    const file = await fetch(base + '/api/sessions/0a1b2c3d/files/order%201.png')
    expect(file.status).toBe(200)
    expect(await file.text()).toBe('PNG!')
    expect((await fetch(base + '/api/sessions/0a1b2c3d/files/other.png')).status).toBe(404)
  })

  it('serves a file the session sent the user, by its call', async () => {
    const shared = await fetch(base + '/api/sessions/0a1b2c3d/shared/toolu_2/0')
    expect(shared.status).toBe(200)
    expect(shared.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(await shared.text()).toBe('# Audit')
    expect((await fetch(base + '/api/sessions/0a1b2c3d/shared/toolu_2/1')).status).toBe(404)
    expect((await fetch(base + '/api/sessions/0a1b2c3d/shared/toolu_1/0')).status).toBe(404)
    expect((await fetch(base + '/api/sessions/bad/shared/toolu_2/0')).status).toBe(400)
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

  it("serves today's spend per account in the page's time zone", async () => {
    const spend = await fetch(base + '/api/stats/spend?tz=Europe/Berlin')
    expect(await spend.json()).toEqual({ state: 'off', reason: 'spend Europe/Berlin' })
    expect((await fetch(base + '/api/stats/spend?tz=x%27;drop')).status).toBe(400)
  })

  it('serves the tokens per account of today and of 30 days in the page\'s time zone', async () => {
    const tokens = await fetch(base + '/api/stats/tokens?tz=Europe/Berlin')
    expect(await tokens.json()).toEqual({ state: 'off', reason: 'tokens Europe/Berlin' })
    expect((await fetch(base + '/api/stats/tokens?tz=x%27;drop')).status).toBe(400)
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
    expect(await known.json()).toEqual({ project: 'ABC', task: 'ABC-1', handoffs: 2, first: 193_000, source: 'calibrated', late: 212_000, hard: 237_000 })
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
