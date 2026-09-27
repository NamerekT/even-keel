import { readFile } from 'node:fs/promises'
import { currentLimits, parseLimitsFile, type RateLimits } from './model.js'

export interface LimitsWatcherOptions {
  file: string
  intervalMs: number
  notBefore: () => string | null
  onChange: (limits: RateLimits | null) => void
  onError: (error: unknown) => void
}

export class LimitsWatcher {
  private received: RateLimits | undefined
  private shown = 'null'
  private timer: NodeJS.Timeout | undefined

  constructor(private readonly options: LimitsWatcherOptions) {}

  get limits(): RateLimits | null {
    return currentLimits(this.received, new Date(), this.options.notBefore())
  }

  start(): void {
    if (this.timer !== undefined) return
    const tick = () => {
      void this.tick().finally(() => {
        this.timer = setTimeout(tick, this.options.intervalMs)
      })
    }
    tick()
  }

  private async tick(): Promise<void> {
    try {
      const parsed = parseLimitsFile(JSON.parse(await readFile(this.options.file, 'utf8')))
      if (parsed !== undefined) this.received = parsed
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) this.options.onError(error)
    }
    const limits = this.limits
    const shown = JSON.stringify(limits)
    if (shown === this.shown) return
    this.shown = shown
    this.options.onChange(limits)
  }
}
