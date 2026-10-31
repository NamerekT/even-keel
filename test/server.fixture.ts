import { mkdtempSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { EventHub } from '../src/events.js'
import { guardHosts } from '../src/guard.js'
import { createEvenKeelServer, type AccountControl, type ChainControl, type ServerDeps } from '../src/server.js'

export const STANDARD = { doc: 'docs/design.md', files: ['web/**/*.tsx'], except: ['**/*.test.*'], shots: true }

export async function serverFixture(overrides: Partial<ServerDeps> = {}) {
  const publicDir = mkdtempSync(join(tmpdir(), 'even-keel-public-'))
  writeFileSync(join(publicDir, 'index.html'), '<title>Even Keel</title>')
  const hub = new EventHub()
  const calls: unknown[][] = []
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
    discoverGlobal: async (...args) => { record('discoverGlobal')(...args) },
    useGlobal: async (...args) => { record('useGlobal')(...args) },
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
      trust: (project, account) => {
        calls.push(['trust', { project, account }])
        return { folder: 'D:/abc', trusted: false, platform: 'win32', user: 'svc' }
      },
      add: record('add'),
      profileMoves: async (id, moves) => record('profileMoves')(id, moves),
      sourceMoves: async (project, feed, moves) => record('sourceMoves')(project, feed, moves),
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
    mail: (id, event) => (id !== 'chain-session' ? undefined : Promise.resolve(event === 'PostToolUse' ? { message: `mail on ${event}`, finish: () => {} } : null)),
    tools: async (project) => (project === 'ABC' ? { project } : undefined),
    vocabulary: async (id) => {
      if (id === 'down') throw new Error('github: HTTP 502')
      return id === '0b1c2d3e' ? { statuses: [{ name: 'Open', category: 'ToDo' }], labels: ['bug'] } : undefined
    },
    profileStatuses: async (id) => (id === 'p-huly' ? [{ name: 'Todo', category: 'ToDo' }, { name: 'In Review', category: 'Active' }] : undefined),
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
    ...overrides,
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const close = () => new Promise((resolve) => server.close(() => resolve()))
  return { hub, publicDir, calls, base, close, server }
}

