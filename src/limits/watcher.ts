import { readFile } from 'node:fs/promises'
import { currentLimits, newestLimits, parseLimitsFile, type RateLimits } from './model.js'
import { parseUsage, type UsageHealth } from './usage.js'

export interface LimitsWatcherOptions {
  file: string
  intervalMs: number
  usage: () => Promise<string>
  usageIntervalMs: number
  notBefore: () => string | null
  onChange: () => void
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
  private health: UsageHealth = { state: 'waiting', reason: null, since: null }

  constructor(private readonly options: LimitsWatcherOptions) {}

  get usage(): UsageHealth {
    return this.health
  }

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
      const message = error instanceof Error ? error.message : String(error)
      answer = { kind: 'unknown' as const, reason: `the call failed: ${message.trim().slice(0, 200)}` }
    }
    if (answer.kind === 'spent') {
      this.usageOff = true
      this.polled = undefined
      this.setHealth('off', answer.reason, at)
      this.options.onError(new Error(`claude -p /usage may have reached the model (${answer.reason}); /usage polling is off until restart`))
    } else if (answer.kind === 'unknown') {
      this.polled = undefined
      if (this.health.state !== 'unread' || this.health.reason !== answer.reason) {
        this.options.onError(new Error(`claude -p /usage answered without readable limits: ${answer.reason}`))
      }
      this.setHealth('unread', answer.reason, at)
    } else {
      this.polled = answer.limits
      this.setHealth('ok', null, at)
    }
    this.publish()
  }

  private setHealth(state: UsageHealth['state'], reason: string | null, at: string): void {
    if (this.health.state === state && this.health.reason === reason) return
    this.health = { state, reason, since: at }
  }

  private publish(): void {
    const shown = JSON.stringify([this.limits, this.health])
    if (shown === this.shown) return
    this.shown = shown
    this.options.onChange()
  }
}
