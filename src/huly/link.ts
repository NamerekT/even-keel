import type { HulySource } from './source.js'

export interface HulyLinkOptions {
  connect: () => Promise<HulySource>
  timeoutMs: number
}

export class HulyLink {
  private source: Promise<HulySource> | undefined
  private closed = false

  constructor(private readonly options: HulyLinkOptions) {}

  async run<T>(call: (source: HulySource) => Promise<T>): Promise<T> {
    if (this.closed) throw new Error('huly: link is closed')
    const pending = (this.source ??= this.options.connect())
    try {
      return await withTimeout(pending.then(call), this.options.timeoutMs)
    } catch (error) {
      this.drop(pending)
      throw error
    }
  }

  async close(): Promise<void> {
    this.closed = true
    const pending = this.source
    this.source = undefined
    await pending?.then((source) => source.close()).catch(() => {})
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
