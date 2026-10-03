import type { BatonState, SessionRecord } from '../../../src/state.js'
import type { StatsAnswer, StatsQuery } from '../../../src/stats/model.js'

export type Link = 'connecting' | 'live' | 'stale'

export interface LiveSnapshot {
  state: BatonState | null
  link: Link
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
  stats(project: string, query: StatsQuery): Promise<StatsAnswer>
}

export interface LiveDeps {
  fetchState: () => Promise<BatonState>
  openEvents: () => EventStream
  sendCommand: (name: string, body: Record<string, unknown>) => Promise<BatonState>
  fetchSession: (sessionId: string) => Promise<SessionRecord | null>
  fetchStats: (project: string, query: StatsQuery) => Promise<StatsAnswer>
}

const CLOSED = 2
const FIRST_RETRY_MS = 1_000
const MAX_RETRY_MS = 10_000
const SILENCE_MS = 45_000

export class LiveConnection implements LiveSource {
  private current: LiveSnapshot = { state: null, link: 'connecting' }
  private readonly listeners = new Set<() => void>()
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

  stats(project: string, query: StatsQuery): Promise<StatsAnswer> {
    return this.deps.fetchStats(project, query)
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
      this.update({ state: JSON.parse(event.data as string) as BatonState, link: 'live' })
    })
    stream.addEventListener('ping', () => {
      if (stream !== this.stream) return
      this.watchSilence()
      if (this.current.state !== null) this.update({ ...this.current, link: 'live' })
    })
    stream.onerror = () => {
      if (stream !== this.stream) return
      this.markStale()
      if (stream.readyState === CLOSED) this.scheduleRetry()
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
    if (next.state === this.current.state && next.link === this.current.link) return
    this.current = next
    for (const listener of this.listeners) listener()
  }
}
