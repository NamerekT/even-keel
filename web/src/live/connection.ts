import type { Notice } from '../../../src/notice/notice.js'
import type { Feed } from '../../../src/sessions/transcript.js'
import type { EvenKeelState, SessionRecord } from '../../../src/state.js'
import type { PeriodQuery, StatsAnswer, StatsFilter, StatsHistory, StatsPeriod, StatsTaskDetail } from '../../../src/stats/model.js'
import type { CompareQuery, RuleDiffFile, RulesQuery, StatsCompare, StatsRules } from '../../../src/stats/rules.js'
import type { CheckpointThreshold } from '../../../src/stats/checkpoint.js'
import type { StatsSteps } from '../../../src/stats/steps.js'
import type { ToolsView } from '../../../src/tools/model.js'
import type { TaskCard } from '../../../src/tracker/card.js'

export type Link = 'connecting' | 'live' | 'stale'

export interface LiveSnapshot {
  state: EvenKeelState | null
  link: Link
  /** Why the service started nothing: its storage is from a newer Even Keel or could not be migrated. */
  blocked?: Notice
}

export interface EventStream {
  readonly readyState: number
  onopen: ((event: Event) => void) | null
  onerror: ((event: Event) => void) | null
  addEventListener(type: string, listener: (event: MessageEvent) => void): void
  close(): void
}

export interface LiveSource {
  subscribe(listener: () => void): () => void
  snapshot(): LiveSnapshot
  retryNow(): void
  command(name: string, body?: Record<string, unknown>): Promise<void>
  session(sessionId: string): Promise<SessionRecord | null>
  /** Lines of the whole transcript from index `after` on, and its last turn. */
  transcript(sessionId: string, after: number): Promise<Feed | null>
  /** Calls `listener` each time the service says the session's transcript changed; returns the unsubscribe. */
  onTranscript(sessionId: string, listener: () => void): () => void
  /** The address of picture `index` of the result of call `tool`, for an image line of the transcript. */
  imageUrl(sessionId: string, tool: string, index: number): string
  /** The address of a picture the user sent the session, by its file name. */
  sentFileUrl(sessionId: string, name: string): string
  tools(project: string): Promise<ToolsView | null>
  card(task: string): Promise<TaskCard | null>
  statsHistory(filter: StatsFilter): Promise<StatsAnswer<StatsHistory>>
  statsPeriod(query: PeriodQuery): Promise<StatsAnswer<StatsPeriod>>
  statsSteps(query: PeriodQuery): Promise<StatsAnswer<StatsSteps>>
  statsCheckpoints(): Promise<StatsAnswer<CheckpointThreshold[]>>
  statsSpend(tz: string): Promise<StatsAnswer<Record<string, number>>>
  statsTask(task: string): Promise<StatsAnswer<StatsTaskDetail>>
  statsRules(query: RulesQuery): Promise<StatsAnswer<StatsRules>>
  statsRuleDiff(changes: string[]): Promise<StatsAnswer<RuleDiffFile[]>>
  statsCompare(query: CompareQuery): Promise<StatsAnswer<StatsCompare>>
}

export interface LiveDeps {
  fetchState: () => Promise<EvenKeelState>
  openEvents: () => EventStream
  sendCommand: (name: string, body: Record<string, unknown>) => Promise<EvenKeelState>
  fetchSession: (sessionId: string) => Promise<SessionRecord | null>
  fetchTranscript: (sessionId: string, after: number) => Promise<Feed | null>
  fetchTools: (project: string) => Promise<ToolsView | null>
  fetchCard: (task: string) => Promise<TaskCard | null>
  fetchStats: <T>(path: string, search: URLSearchParams) => Promise<StatsAnswer<T>>
}

const CLOSED = 2
const FIRST_RETRY_MS = 1_000
const MAX_RETRY_MS = 10_000
const SILENCE_MS = 45_000

export class LiveConnection implements LiveSource {
  private current: LiveSnapshot = { state: null, link: 'connecting' }
  private readonly listeners = new Set<() => void>()
  private readonly transcriptListeners = new Map<string, Set<() => void>>()
  private stream: EventStream | null = null
  private streamed = false
  private retryMs = FIRST_RETRY_MS
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private silenceTimer: ReturnType<typeof setTimeout> | undefined
  private stopped = false

  constructor(private readonly deps: LiveDeps) {}

  start(): void {
    this.deps.fetchState().then(
      (state) => {
        if (!this.streamed && !this.stopped) this.update({ state, link: 'live' })
      },
      () => {},
    )
    this.open()
  }

  stop(): void {
    this.stopped = true
    clearTimeout(this.retryTimer)
    clearTimeout(this.silenceTimer)
    this.stream?.close()
    this.stream = null
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot(): LiveSnapshot {
    return this.current
  }

  retryNow(): void {
    if (this.current.link !== 'stale' || this.stopped) return
    this.open()
  }

  async command(name: string, body: Record<string, unknown> = {}): Promise<void> {
    const state = await this.deps.sendCommand(name, body)
    if (!this.stopped) this.update({ ...this.current, state })
  }

  session(sessionId: string): Promise<SessionRecord | null> {
    return this.deps.fetchSession(sessionId)
  }

  transcript(sessionId: string, after: number): Promise<Feed | null> {
    return this.deps.fetchTranscript(sessionId, after)
  }

  onTranscript(sessionId: string, listener: () => void): () => void {
    const set = this.transcriptListeners.get(sessionId) ?? new Set()
    this.transcriptListeners.set(sessionId, set.add(listener))
    return () => {
      set.delete(listener)
      if (set.size === 0 && this.transcriptListeners.get(sessionId) === set) this.transcriptListeners.delete(sessionId)
    }
  }

  imageUrl(sessionId: string, tool: string, index: number): string {
    return `/api/sessions/${encodeURIComponent(sessionId)}/images/${encodeURIComponent(tool)}/${index}`
  }

  sentFileUrl(sessionId: string, name: string): string {
    return `/api/sessions/${encodeURIComponent(sessionId)}/files/${encodeURIComponent(name)}`
  }

  tools(project: string): Promise<ToolsView | null> {
    return this.deps.fetchTools(project)
  }

  card(task: string): Promise<TaskCard | null> {
    return this.deps.fetchCard(task)
  }

  statsHistory(filter: StatsFilter): Promise<StatsAnswer<StatsHistory>> {
    return this.deps.fetchStats('history', filterSearch(filter))
  }

  statsPeriod(query: PeriodQuery): Promise<StatsAnswer<StatsPeriod>> {
    return this.deps.fetchStats('period', periodSearch(query))
  }

  statsSteps(query: PeriodQuery): Promise<StatsAnswer<StatsSteps>> {
    return this.deps.fetchStats('steps', periodSearch(query))
  }

  statsCheckpoints(): Promise<StatsAnswer<CheckpointThreshold[]>> {
    return this.deps.fetchStats('checkpoints', new URLSearchParams())
  }

  statsSpend(tz: string): Promise<StatsAnswer<Record<string, number>>> {
    return this.deps.fetchStats('spend', new URLSearchParams({ tz }))
  }

  statsTask(task: string): Promise<StatsAnswer<StatsTaskDetail>> {
    return this.deps.fetchStats(`task/${encodeURIComponent(task)}`, new URLSearchParams())
  }

  statsRules(query: RulesQuery): Promise<StatsAnswer<StatsRules>> {
    const search = filterSearch(query)
    if (query.projects !== null) search.set('projects', query.projects.join(','))
    if (query.kinds !== null) search.set('kinds', query.kinds.join(','))
    if (query.purposes !== null) search.set('purposes', query.purposes.join(','))
    if (query.places !== null) search.set('places', query.places.join(','))
    return this.deps.fetchStats('rules', search)
  }

  statsRuleDiff(changes: string[]): Promise<StatsAnswer<RuleDiffFile[]>> {
    return this.deps.fetchStats('rules/diff', new URLSearchParams({ changes: changes.join(',') }))
  }

  statsCompare(query: CompareQuery): Promise<StatsAnswer<StatsCompare>> {
    const search = filterSearch(query)
    search.set('before', query.before)
    search.set('after', query.after)
    if (query.days !== null) search.set('days', String(query.days))
    if (query.projects !== null) search.set('projects', query.projects.join(','))
    return this.deps.fetchStats('rules/compare', search)
  }

  private open(): void {
    clearTimeout(this.retryTimer)
    this.stream?.close()
    const stream = this.deps.openEvents()
    this.stream = stream
    this.watchSilence()

    stream.addEventListener('state', (event) => {
      if (stream !== this.stream) return
      this.streamed = true
      this.retryMs = FIRST_RETRY_MS
      this.watchSilence()
      this.update({ state: JSON.parse(event.data as string) as EvenKeelState, link: 'live' })
    })
    // The service started nothing and only says why; it sends no pings, so its silence is no sign of a lost link.
    stream.addEventListener('blocked', (event) => {
      if (stream !== this.stream) return
      this.streamed = true
      clearTimeout(this.silenceTimer)
      this.update({ state: null, link: 'live', blocked: JSON.parse(event.data as string) as Notice })
    })
    stream.addEventListener('transcript', (event) => {
      if (stream !== this.stream) return
      const { sessionId } = JSON.parse(event.data as string) as { sessionId: string }
      for (const listener of this.transcriptListeners.get(sessionId) ?? []) listener()
    })
    stream.addEventListener('ping', () => {
      if (stream !== this.stream) return
      this.watchSilence()
      if (this.current.state !== null) this.update({ ...this.current, link: 'live' })
    })
    stream.onerror = () => {
      if (stream !== this.stream) return
      this.markStale()
      if (stream.readyState !== CLOSED) return
      // EventSource does not say why it closed: a plain request does, a refused token included.
      this.deps.fetchState().catch(() => {})
      this.scheduleRetry()
    }
  }

  private scheduleRetry(): void {
    clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => this.open(), this.retryMs)
    this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS)
  }

  private watchSilence(): void {
    clearTimeout(this.silenceTimer)
    this.silenceTimer = setTimeout(() => {
      this.markStale()
      this.open()
    }, SILENCE_MS)
  }

  private markStale(): void {
    this.update({ ...this.current, link: 'stale' })
  }

  private update(next: LiveSnapshot): void {
    if (next.state === this.current.state && next.link === this.current.link && next.blocked === this.current.blocked) return
    this.current = next
    for (const listener of this.listeners) listener()
  }
}

function filterSearch(filter: StatsFilter): URLSearchParams {
  const search = new URLSearchParams({ scope: filter.scope, tz: filter.tz })
  if (filter.account !== null) search.set('account', filter.account)
  return search
}

function periodSearch(query: PeriodQuery): URLSearchParams {
  const search = filterSearch(query)
  search.set('from', query.from)
  search.set('to', query.to)
  if (query.projects !== null) search.set('projects', query.projects.join(','))
  return search
}
