import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EvenKeelState } from '../../../src/state.js'
import { LiveConnection, type EventStream } from './connection.js'
import { FAKE_SHARED } from './fakeConfig.js'

class FakeStream implements EventStream {
  readyState = 0
  closed = false
  private readonly listeners = new Map<string, ((event: MessageEvent) => void)[]>()
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  close(): void {
    this.closed = true
    this.readyState = 2
  }

  open(): void {
    this.readyState = 1
    this.onopen?.()
  }

  emit(type: string, data: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new MessageEvent(type, { data: JSON.stringify(data) }))
    }
  }

  fail(readyState: 0 | 2): void {
    this.readyState = readyState
    this.onerror?.()
  }
}

function state(startedAt: string): EvenKeelState {
  return {
    startedAt,
    demo: null,
    platform: 'win32',
    projects: [],
    projectKeys: {},
    projectLabels: {},
    taskPrefixes: {},
    branchDrift: {},
    config: { shared: FAKE_SHARED, projects: {}, trackers: [], feeds: {}, trackerLocked: [] },
    chain: { active: [], parallel: 1, queue: [], projects: {}, skipped: {}, leftovers: {} },
    tasks: [],
    sessions: [],
    limits: null,
    usage: { state: 'ok', reason: null, since: null },
    account: { active: 'global', accounts: [], login: null, loginBlock: null, apps: [], pool: [], missing: [] },
    trackers: [],
    trackerUrls: { default: null, projects: {}, pages: {} },
    ci: {},
    mainCi: {},
    remotes: {},
    sameRepository: {},
    pullReadiness: {},
    launches: [],
    taskSessions: {},
    fixes: {},
    works: {},
    context: { window: 600_000, warn: 50, danger: 80 },
    configError: null,
    packages: { gateway: null, packages: [], projects: {}, keys: [], available: [], marketplace: null, imports: {}, skills: { package: 'my-skills@even-keel-skills', list: [] } },
    secrets: { variables: [], sessionsPending: false },
    profiles: { profiles: [], kinds: [] },
    language: null,
    unattended: false,
    trimTools: true,
    tally: 'local',
    tallyHealth: { state: 'waiting', lastRunAt: null },
    updates: { current: '0.1.0', available: null, toast: false, notes: [], source: 'git', blocked: null, previous: null, progress: null, result: null },
    cliVersions: [],
    cliChecks: [],
    fallbacks: [],
    mailbox: {},
    changelogs: {},
    forwards: {},
    eventLog: [],
  }
}

describe('LiveConnection', () => {
  let streams: FakeStream[]
  let fetchState: ReturnType<typeof vi.fn<() => Promise<EvenKeelState>>>
  let live: LiveConnection
  let commands: { name: string; body: Record<string, unknown> }[]
  let answer: () => Promise<void>

  const last = () => streams.at(-1)!

  beforeEach(() => {
    vi.useFakeTimers()
    streams = []
    commands = []
    answer = async () => {}
    fetchState = vi.fn(async () => state('diagnostic'))
    live = new LiveConnection({
      fetchSession: async () => null,
      fetchTranscript: async () => null,
      fetchCheckpoint: async () => null,
      fetchTools: async () => null,
      fetchCard: async () => null,
      fetchVocabulary: async () => null,
      checkProject: async () => ({ repo: { root: null, current: null, suggested: null, branches: null, notice: null }, entry: null, yields: [], tracker: null, trusted: null, platform: 'win32', user: 'svc', service: true }),
      sendQuery: async () => null,
      sendFile: async (_task, file) => ({ name: file.name, type: file.type, url: '/f' }),
      fetchStats: async () => ({ state: 'off', reason: 'test' }),
      sendCommand: (name, body) => {
        commands.push({ name, body })
        return answer()
      },
      fetchState,
      openEvents: () => {
        const stream = new FakeStream()
        streams.push(stream)
        return stream
      },
    })
    live.start()
  })

  afterEach(() => {
    live.stop()
    vi.useRealTimers()
  })

  it('starts connecting with no data', () => {
    expect(live.snapshot()).toEqual({ state: null, link: 'connecting' })
    expect(streams).toHaveLength(1)
  })

  it('loads the first state only through the stream', async () => {
    expect(fetchState).not.toHaveBeenCalled()
    last().emit('state', state('streamed'))
    expect(live.snapshot()).toEqual({ state: state('streamed'), link: 'live' })
  })

  it('uses a plain request only to diagnose a closed stream, without replacing state', async () => {
    last().emit('state', state('before'))
    last().fail(2)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchState).toHaveBeenCalledOnce()
    expect(live.snapshot()).toEqual({ state: state('before'), link: 'stale' })
  })

  it('holds the reason a service that started nothing sends, without going stale on its silence', async () => {
    const reason = { code: 'storage.newer', params: { file: 'chain.json', version: 3, known: 2 } }
    last().open()
    last().emit('blocked', reason)
    expect(live.snapshot()).toEqual({ state: null, link: 'live', blocked: reason })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(live.snapshot().link).toBe('live')
  })

  it('stays connecting while the first stream frame is missing', async () => {
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchState).not.toHaveBeenCalled()
    expect(live.snapshot()).toEqual({ state: null, link: 'connecting' })
  })

  it('notifies subscribers on every change and stops after unsubscribe', () => {
    const seen: string[] = []
    const unsubscribe = live.subscribe(() => seen.push(live.snapshot().link))
    last().emit('state', state('a'))
    last().fail(0)
    unsubscribe()
    last().emit('state', state('b'))
    expect(seen).toEqual(['live', 'stale'])
  })

  it('marks the data stale while the browser retries by itself, and live again once it is back', () => {
    last().emit('state', state('before'))
    last().fail(0)
    expect(live.snapshot()).toEqual({ state: state('before'), link: 'stale' })

    vi.advanceTimersByTime(30_000)
    expect(streams).toHaveLength(1)

    last().emit('state', state('after'))
    expect(live.snapshot()).toEqual({ state: state('after'), link: 'live' })
  })

  it('reopens a closed stream with a growing pause and resets it after success', () => {
    last().fail(2)
    expect(live.snapshot().link).toBe('stale')

    vi.advanceTimersByTime(999)
    expect(streams).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(streams).toHaveLength(2)

    last().fail(2)
    vi.advanceTimersByTime(1_999)
    expect(streams).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(streams).toHaveLength(3)

    last().emit('state', state('back'))
    last().fail(2)
    vi.advanceTimersByTime(1_000)
    expect(streams).toHaveLength(4)
  })

  it('caps the pause between attempts', () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      last().fail(2)
      vi.advanceTimersByTime(10_000)
    }
    expect(streams).toHaveLength(11)
  })

  it('drops a silent stream and opens a new one', () => {
    last().open()
    last().emit('state', state('a'))
    vi.advanceTimersByTime(30_000)
    last().emit('ping', { at: 'now' })
    vi.advanceTimersByTime(44_999)
    expect(live.snapshot().link).toBe('live')
    expect(streams).toHaveLength(1)

    vi.advanceTimersByTime(1)
    expect(live.snapshot().link).toBe('stale')
    expect(streams[0]!.closed).toBe(true)
    expect(streams).toHaveLength(2)
  })

  it('retries at once on demand when stale, and does nothing when live', () => {
    last().emit('state', state('a'))
    live.retryNow()
    expect(streams).toHaveLength(1)

    last().fail(2)
    live.retryNow()
    expect(streams).toHaveLength(2)
    expect(streams[0]!.closed).toBe(true)
    vi.advanceTimersByTime(1_000)
    expect(streams).toHaveLength(2)
  })

  it('ignores late events from a stream it has already replaced', () => {
    const old = last()
    old.fail(2)
    vi.advanceTimersByTime(1_000)
    last().emit('state', state('new'))

    old.emit('state', state('old'))
    old.fail(2)
    expect(live.snapshot()).toEqual({ state: state('new'), link: 'live' })
    vi.advanceTimersByTime(10_000)
    expect(streams).toHaveLength(2)
  })

  it('acknowledges a command without replacing state before the stream patch', async () => {
    last().emit('state', state('before'))
    await live.command('start', { project: 'ABC' })
    expect(commands).toEqual([{ name: 'start', body: { project: 'ABC' } }])
    expect(live.snapshot()).toEqual({ state: state('before'), link: 'live' })
  })

  it('lays a patch over the last state the stream sent, not over a command answer', async () => {
    last().emit('state', state('before'))
    await live.command('start', { project: 'ABC' })
    last().emit('statePatch', { parts: { unattended: true } })
    expect(live.snapshot()).toEqual({ state: { ...state('before'), unattended: true }, link: 'live' })
  })

  it('ignores a patch before the stream sent a whole state', async () => {
    last().emit('statePatch', { parts: { unattended: true } })
    expect(live.snapshot().state).toBeNull()
  })

  it('passes a failed command on to the caller and keeps the state', async () => {
    last().emit('state', state('before'))
    answer = () => Promise.reject(new Error('ABC is not a configured project'))
    await expect(live.command('start', { project: 'ABC' })).rejects.toThrow('not a configured project')
    expect(live.snapshot().state).toEqual(state('before'))
  })

  it('keeps a newer stream frame when an older command finishes later', async () => {
    let finish!: () => void
    answer = () => new Promise<void>((resolve) => { finish = resolve })
    last().emit('state', state('before'))
    const pending = live.command('start', { project: 'ABC' })
    last().emit('statePatch', { parts: { unattended: true } })
    finish()
    await pending
    expect(live.snapshot().state).toEqual({ ...state('before'), unattended: true })
  })

  it('replaces the patch base with a complete frame after reconnecting', async () => {
    last().emit('state', state('old'))
    last().fail(2)
    live.retryNow()
    last().emit('statePatch', { parts: { unattended: true } })
    expect(live.snapshot().state).toEqual(state('old'))
    last().emit('state', state('restarted'))
    last().emit('statePatch', { parts: { trimTools: false } })
    expect(live.snapshot().state).toEqual({ ...state('restarted'), trimTools: false })
  })

  it('closes the stream and fires no timers after stop', () => {
    last().fail(2)
    live.stop()
    vi.advanceTimersByTime(60_000)
    expect(streams).toHaveLength(1)
    expect(streams[0]!.closed).toBe(true)
  })

  it('tells the listeners of a session that its transcript changed, and no one else', () => {
    const calls: string[] = []
    const off = live.onTranscript('s-1', () => calls.push('first'))
    live.onTranscript('s-1', () => calls.push('second'))
    live.onTranscript('s-2', () => calls.push('other'))

    last().emit('transcript', { sessionId: 's-1' })
    off()
    last().emit('transcript', { sessionId: 's-1' })

    expect(calls).toEqual(['first', 'second', 'second'])
  })
})
