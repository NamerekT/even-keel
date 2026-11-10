import { NoticeError } from '../notice/notice.js'
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
  private readonly timeouts = new Map<string, { count: number; retryAt: number; error: Error }>()
  /** The error the tracker did not answer with: the page's calls fail at once while it holds (BTN-825). */
  private unanswered: Error | undefined

  constructor(private readonly options: TrackerLinkOptions) {}

  get name(): string {
    return this.options.name
  }

  get health(): TrackerHealth {
    return this.current
  }

  /**
   * A call the page asks for (BTN-825): while the tracker did not answer — a timeout or a broken connection — it fails at
   * once, with the error it failed with, and not after the whole timeout. The chain's own reads go through `run`: they are
   * what brings the tracker back, and they keep their own delay.
   */
  async page<T>(call: (source: Tracker) => Promise<T>): Promise<T> {
    if (this.unanswered !== undefined) throw this.unanswered
    return await this.run(call)
  }

  async run<T>(call: (source: Tracker) => Promise<T>, operation?: string): Promise<T> {
    return this.call(call, operation, false)
  }

  /**
   * A write: a batch of `tasks_create`, a `task_update` (BTN-929). It runs as long as the tracker keeps answering:
   * `timeoutMs` bounds the silence between two answers — a finished HTTP request or a settled call of the source, its
   * editor and the editor's parts — not the whole call. After a timeout every next call of the source in it throws, so a
   * batch stops instead of going on behind the session's back. A timeout after an answer does not put the tracker down:
   * it answers, and the chain's reads judge its health. `operation` names the write in the log.
   */
  async write<T>(call: (source: Tracker) => Promise<T>, operation: string): Promise<T> {
    return this.call(call, operation, true)
  }

  private async call<T>(call: (source: Tracker) => Promise<T>, operation: string | undefined, write: boolean): Promise<T> {
    if (this.closed) throw new Error(`${this.options.name}: link is closed`)
    const retry = operation === undefined || write ? undefined : this.timeouts.get(operation)
    if (retry !== undefined && Date.now() < retry.retryAt) throw retry.error
    const started = Date.now()
    const controller = new AbortController()
    const timer = write
      ? new Timer(this.options.timeoutMs, () => new CallTimeout(`${this.options.name}: ${operation} got no answer for ${this.options.timeoutMs} ms`))
      : new Timer(this.options.timeoutMs, () => new CallTimeout(`${this.options.name}: call timed out after ${this.options.timeoutMs} ms`))
    let answers = 0
    const answer = () => {
      answers++
      if (write) timer.restart()
    }
    const diagnostics: CallDiagnostics = { operation: write ? operation! : 'connect', requests: 0, measured: false, active: new Map(), signal: controller.signal, onAnswer: answer }
    const pending = callDiagnostics.run(diagnostics, () => (this.source ??= this.options.connect()))
    try {
      const steps = <S extends object>(target: S): S => new Proxy(target, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver)
          if (write && typeof value === 'object' && value !== null && !Array.isArray(value)) return steps(value)
          if (typeof value !== 'function') return value
          return (...args: unknown[]) => {
            if (!write) {
              diagnostics.operation = String(property)
              return Reflect.apply(value, target, args)
            }
            if (controller.signal.aborted) throw controller.signal.reason
            const result: unknown = Reflect.apply(value, target, args)
            if (result instanceof Promise) return result.then((settled: unknown) => (answer(), settled))
            return result
          }
        },
      })
      const work = callDiagnostics.run(diagnostics, () => pending.then((source) => call(steps(source))))
      const result = await timer.race(work)
      if (!write) {
        const previous = this.timeouts.get(operation ?? diagnostics.operation)
        if (previous !== undefined) {
          this.timeouts.delete(operation ?? diagnostics.operation)
          ;(this.options.onDiagnostic ?? console.warn)(`${this.options.name}: ${diagnostics.operation} reads again after ${previous.count} failure${previous.count === 1 ? '' : 's'}`)
        }
      }
      const elapsed = Date.now() - started
      if (elapsed > this.options.timeoutMs / 2 && Date.now() - (this.slowLogged.get(diagnostics.operation) ?? -Infinity) >= 600_000) {
        this.slowLogged.set(diagnostics.operation, started + elapsed)
        this.diagnostic('slow call', elapsed, diagnostics)
      }
      this.answered()
      return result
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      if (didNotAnswer(error)) {
        controller.abort(error)
        const kind = failure instanceof CallTimeout ? 'call timed out' : 'connection failed'
        if (write) {
          // Writes are rare and each is a session's call: every failure is logged, none is delayed.
          this.diagnostic(kind, Date.now() - started, diagnostics)
          if (answers > 0) {
            this.answered()
            throw error
          }
        } else {
          const key = operation ?? diagnostics.operation
          const count = (this.timeouts.get(key)?.count ?? 0) + 1
          this.timeouts.set(key, { count, retryAt: Date.now() + Math.min(300_000, 20_000 * 2 ** Math.min(count - 1, 4)), error: failure })
          if (count === 1) this.diagnostic(kind, Date.now() - started, diagnostics)
        }
        this.unanswered = failure
      }
      if (error instanceof TrackerNotFound) {
        this.answered()
        throw error
      }
      this.drop(pending)
      this.report({ state: 'down', lastOkAt: this.current.lastOkAt, error: errorText(error), ...(error instanceof NoticeError && { notice: error.notice }) })
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
    this.unanswered = undefined
    const pending = this.source
    this.source = undefined
    pending?.then((source) => source.close()).catch(() => {})
    this.report({ state: 'connecting', lastOkAt: this.current.lastOkAt, error: null })
  }

  async close(): Promise<void> {
    this.closed = true
    this.unanswered = undefined
    const pending = this.source
    this.source = undefined
    await pending?.then((source) => source.close()).catch(() => {})
  }

  private answered(): void {
    this.unanswered = undefined
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

/**
 * The tracker did not answer: the call timed out, the request of the adapter timed out or the connection failed. Node's
 * `fetch` says only "fetch failed" and keeps the reason (refused, connect timeout) in `cause` (BTN-825).
 */
export function didNotAnswer(error: unknown): boolean {
  if (error instanceof CallTimeout) return true
  let each: unknown = error
  while (each instanceof Error) {
    if (each.name === 'TimeoutError') return true
    if (each instanceof TypeError && (each.message === 'fetch failed' || each.message === 'Failed to fetch')) return true
    each = each.cause
  }
  return false
}

/** A timeout a call races against; `restart` gives it the whole `ms` again from now. */
class Timer {
  private timer: NodeJS.Timeout | undefined
  private reject: ((error: Error) => void) | undefined
  private settled = false

  constructor(private readonly ms: number, private readonly error: () => Error) {}

  race<T>(promise: Promise<T>): Promise<T> {
    const timeout = new Promise<never>((_, reject) => {
      this.reject = reject
      this.restart()
    })
    return Promise.race([promise, timeout]).finally(() => {
      this.settled = true
      clearTimeout(this.timer)
    })
  }

  restart(): void {
    if (this.settled || this.reject === undefined) return
    clearTimeout(this.timer)
    const reject = this.reject
    this.timer = setTimeout(() => reject(this.error()), this.ms)
  }
}
