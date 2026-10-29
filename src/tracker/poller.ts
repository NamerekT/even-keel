import { errorText, type TrackerLink } from './link.js'
import { diffStatuses, type StatusChange, type TaskStatus } from './model.js'

export interface StatusPollerOptions {
  link: TrackerLink
  watched: () => string[]
  intervalMs: number
  onChange: (changes: StatusChange[]) => void
  onError: (error: unknown) => void
  onRecovered?: () => void
}

export class StatusPoller {
  private readonly known = new Map<string, TaskStatus>()
  private timer: NodeJS.Timeout | undefined
  private running: Promise<void> | undefined
  private stopped = true
  private failure: string | undefined

  constructor(private readonly options: StatusPollerOptions) {}

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.schedule(0)
  }

  async stop(): Promise<void> {
    this.stopped = true
    clearTimeout(this.timer)
    await this.running
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => {
      this.running = this.tick().finally(() => {
        if (!this.stopped) this.schedule(this.options.intervalMs)
      })
    }, delay)
  }

  private async tick(): Promise<void> {
    const watched = this.options.watched()
    if (watched.length === 0) return
    try {
      const tasks = await this.options.link.run((source) => source.tasks(watched), JSON.stringify(['tasks', ...watched]))
      const changes = diffStatuses(this.known, tasks, watched)
      for (const change of changes) {
        if (change.to === null) this.known.delete(change.id)
        else this.known.set(change.id, change.to)
      }
      if (changes.length > 0) this.options.onChange(changes)
      if (this.failure !== undefined) {
        this.failure = undefined
        this.options.onRecovered?.()
      }
    } catch (error) {
      const text = errorText(error)
      if (text === this.failure) return
      this.failure = text
      this.options.onError(error)
    }
  }
}
