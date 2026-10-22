import type { TrackerHealth } from './health.js'
import { TrackerNotFound, type Tracker } from './source.js'

export interface TrackerLinkOptions {
  name: string
  connect: () => Promise<Tracker>
  timeoutMs: number
  now?: () => Date
  onHealth?: (health: TrackerHealth) => void
}

export class TrackerLink {
  private source: Promise<Tracker> | undefined
  private closed = false
  private current: TrackerHealth = { state: 'connecting', lastOkAt: null, error: null }

  constructor(private readonly options: TrackerLinkOptions) {}

  get health(): TrackerHealth {
    return this.current
  }

  async run<T>(call: (source: Tracker) => Promise<T>): Promise<T> {
    if (this.closed) throw new Error(`${this.options.name}: link is closed`)
    const pending = (this.source ??= this.options.connect())
    try {
      const result = await withTimeout(pending.then(call), this.options.timeoutMs, this.options.name)
      this.answered()
      return result
    } catch (error) {
      if (error instanceof TrackerNotFound) {
        this.answered()
        throw error
      }
      this.drop(pending)
      this.report({ state: 'down', lastOkAt: this.current.lastOkAt, error: errorText(error) })
      throw error
    }
  }

  /** Closes the connection, if any: the next call connects again, with what `connect` reads by then (new credentials). */
  reset(): void {
    const pending = this.source
    this.source = undefined
    pending?.then((source) => source.close()).catch(() => {})
    this.report({ state: 'connecting', lastOkAt: this.current.lastOkAt, error: null })
  }

  async close(): Promise<void> {
    this.closed = true
    const pending = this.source
    this.source = undefined
    await pending?.then((source) => source.close()).catch(() => {})
  }

  private answered(): void {
    this.report({ state: 'live', lastOkAt: (this.options.now?.() ?? new Date()).toISOString(), error: null })
  }

  private report(next: TrackerHealth): void {
    const { current } = this
    if (next.state === current.state && next.lastOkAt === current.lastOkAt && next.error === current.error) return
    this.current = next
    this.options.onHealth?.(next)
  }

  private drop(pending: Promise<Tracker>): void {
    if (this.source !== pending) return
    this.source = undefined
    pending.then((source) => source.close()).catch(() => {})
  }
}

/** The message of an error with its cause: Node's `fetch` says only "fetch failed" and keeps the reason (DNS, refused) in `cause`. */
export function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const { cause } = error
  return cause instanceof Error ? `${error.message}: ${cause.message}` : error.message
}

function withTimeout<T>(promise: Promise<T>, ms: number, name: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${name}: call timed out after ${ms} ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
