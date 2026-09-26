import type { HulyHealth } from './health.js'
import type { HulySource } from './source.js'

export interface HulyLinkOptions {
  connect: () => Promise<HulySource>
  timeoutMs: number
  now?: () => Date
  onHealth?: (health: HulyHealth) => void
}

export class HulyLink {
  private source: Promise<HulySource> | undefined
  private closed = false
  private current: HulyHealth = { state: 'connecting', lastOkAt: null, error: null }

  constructor(private readonly options: HulyLinkOptions) {}

  get health(): HulyHealth {
    return this.current
  }

  async run<T>(call: (source: HulySource) => Promise<T>): Promise<T> {
    if (this.closed) throw new Error('huly: link is closed')
    const pending = (this.source ??= this.options.connect())
    try {
      const result = await withTimeout(pending.then(call), this.options.timeoutMs)
      this.report({ state: 'live', lastOkAt: (this.options.now?.() ?? new Date()).toISOString(), error: null })
      return result
    } catch (error) {
      this.drop(pending)
      const message = error instanceof Error ? error.message : String(error)
      this.report({ state: 'down', lastOkAt: this.current.lastOkAt, error: message })
      throw error
    }
  }

  async close(): Promise<void> {
    this.closed = true
    const pending = this.source
    this.source = undefined
    await pending?.then((source) => source.close()).catch(() => {})
  }

  private report(next: HulyHealth): void {
    const { current } = this
    if (next.state === current.state && next.lastOkAt === current.lastOkAt && next.error === current.error) return
    this.current = next
    this.options.onHealth?.(next)
  }

  private drop(pending: Promise<HulySource>): void {
    if (this.source !== pending) return
    this.source = undefined
    pending.then((source) => source.close()).catch(() => {})
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`huly: call timed out after ${ms} ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
