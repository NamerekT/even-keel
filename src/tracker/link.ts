import type { TrackerHealth } from './health.js'
import { TrackerNotFound, type Tracker } from './source.js'
import { callDiagnostics, longestRequest, type CallDiagnostics } from './diagnostics.js'

export interface TrackerLinkOptions {
  name: string
  connect: () => Promise<Tracker>
  timeoutMs: number
  now?: () => Date
  onHealth?: (health: TrackerHealth) => void
  onDiagnostic?: (message: string) => void
}

export class TrackerLink {
  private source: Promise<Tracker> | undefined
  private closed = false
  private current: TrackerHealth = { state: 'connecting', lastOkAt: null, error: null }
  private readonly slowLogged = new Map<string, number>()
  private readonly timeouts = new Map<string, { count: number; retryAt: number; error: CallTimeout }>()

  constructor(private readonly options: TrackerLinkOptions) {}

  get health(): TrackerHealth {
    return this.current
  }

  async run<T>(call: (source: Tracker) => Promise<T>, operation?: string): Promise<T> {
    if (this.closed) throw new Error(`${this.options.name}: link is closed`)
    const retry = operation === undefined ? undefined : this.timeouts.get(operation)
    if (retry !== undefined && Date.now() < retry.retryAt) throw retry.error
    const started = Date.now()
    const controller = new AbortController()
    const diagnostics: CallDiagnostics = { operation: 'connect', requests: 0, measured: false, active: new Map(), signal: controller.signal }
    const pending = callDiagnostics.run(diagnostics, () => (this.source ??= this.options.connect()))
    try {
      const work = callDiagnostics.run(diagnostics, () => pending.then((source) => call(new Proxy(source, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver)
          if (typeof value !== 'function') return value
          return (...args: unknown[]) => {
            diagnostics.operation = String(property)
            return Reflect.apply(value, target, args)
          }
        },
      }))))
      const result = await withTimeout(work, this.options.timeoutMs, this.options.name)
      const previous = this.timeouts.get(operation ?? diagnostics.operation)
      if (previous !== undefined) {
        this.timeouts.delete(operation ?? diagnostics.operation)
        ;(this.options.onDiagnostic ?? console.warn)(`${this.options.name}: ${diagnostics.operation} reads again after ${previous.count} timeout${previous.count === 1 ? '' : 's'}`)
      }
      const elapsed = Date.now() - started
      if (elapsed > this.options.timeoutMs / 2 && Date.now() - (this.slowLogged.get(diagnostics.operation) ?? -Infinity) >= 600_000) {
        this.slowLogged.set(diagnostics.operation, started + elapsed)
        this.diagnostic('slow call', elapsed, diagnostics)
      }
      this.answered()
      return result
    } catch (error) {
      if (error instanceof CallTimeout) {
        controller.abort(error)
        const key = operation ?? diagnostics.operation
        const count = (this.timeouts.get(key)?.count ?? 0) + 1
        this.timeouts.set(key, { count, retryAt: Date.now() + Math.min(300_000, 20_000 * 2 ** Math.min(count - 1, 4)), error })
        if (count === 1) this.diagnostic('call timed out', Date.now() - started, diagnostics)
      }
      if (error instanceof TrackerNotFound) {
        this.answered()
        throw error
      }
      this.drop(pending)
      this.report({ state: 'down', lastOkAt: this.current.lastOkAt, error: errorText(error) })
      throw error
    }
  }

  private diagnostic(kind: string, elapsed: number, call: CallDiagnostics): void {
    const count = call.measured ? `${call.requests} HTTP request${call.requests === 1 ? '' : 's'}` : 'HTTP request count unavailable'
    const request = longestRequest(call)
    const longest = request ? `, longest ${request.ms} ms ${request.path}` : ''
    ;(this.options.onDiagnostic ?? console.warn)(`${this.options.name}: ${kind} ${call.operation}, ${elapsed} ms, ${count}${longest}`)
  }

  /** Closes the connection, if any: the next call connects again, with what `connect` reads by then (new credentials). */
  reset(): void {
    this.timeouts.clear()
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

class CallTimeout extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number, name: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CallTimeout(`${name}: call timed out after ${ms} ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
