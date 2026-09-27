import { readFile } from 'node:fs/promises'
import { currentLimits, newestLimits, parseLimitsFile, type RateLimits } from './model.js'
import { parseUsage } from './usage.js'

export interface LimitsWatcherOptions {
  file: string
  intervalMs: number
  usage: () => Promise<string>
  usageIntervalMs: number
  notBefore: () => string | null
  onChange: (limits: RateLimits | null) => void
  onError: (error: unknown) => void
}

export class LimitsWatcher {
  private received: RateLimits | undefined
  private polled: RateLimits | undefined
  private shown = 'null'
  private timer: NodeJS.Timeout | undefined
  private usageTimer: NodeJS.Timeout | undefined
  private usageRunning = false
  private usageAgain = false
  private usageOff = false
  private usageUnread = false

  constructor(private readonly options: LimitsWatcherOptions) {}

  get limits(): RateLimits | null {
    return currentLimits(newestLimits(this.received, this.polled), new Date(), this.options.notBefore())
  }

  start(): void {
    if (this.timer !== undefined) return
    const tick = () => {
      void this.tick().finally(() => {
        this.timer = setTimeout(tick, this.options.intervalMs)
      })
    }
    tick()
    this.refresh()
  }

  refresh(): void {
    if (this.usageOff) return
    if (this.usageRunning) {
      this.usageAgain = true
      return
    }
    clearTimeout(this.usageTimer)
    this.usageRunning = true
    void this.pollUsage().finally(() => {
      this.usageRunning = false
      if (this.usageOff) return
      if (this.usageAgain) {
        this.usageAgain = false
        this.refresh()
      } else this.usageTimer = setTimeout(() => this.refresh(), this.options.usageIntervalMs)
    })
  }

  private async tick(): Promise<void> {
    try {
      const parsed = parseLimitsFile(JSON.parse(await readFile(this.options.file, 'utf8')))
      if (parsed !== undefined) this.received = parsed
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) this.options.onError(error)
    }
    this.publish()
  }

  private async pollUsage(): Promise<void> {
    const at = new Date().toISOString()
    let answer
    try {
      answer = parseUsage(await this.options.usage(), at)
    } catch (error) {
      this.options.onError(error)
      return
    }
    if (answer.kind === 'spent') {
      this.usageOff = true
      this.options.onError(new Error('claude -p /usage reached the model and spent quota; /usage polling is off until restart'))
      return
    }
    if (answer.kind === 'unknown') {
      if (!this.usageUnread) this.options.onError(new Error('claude -p /usage answered without readable limits'))
      this.usageUnread = true
      return
    }
    this.usageUnread = false
    this.polled = answer.limits
    this.publish()
  }

  private publish(): void {
    const limits = this.limits
    const shown = JSON.stringify(limits)
    if (shown === this.shown) return
    this.shown = shown
    this.options.onChange(limits)
  }
}
