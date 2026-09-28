import type { AccountHome } from './homes.js'

export interface DaemonRefreshOptions {
  share: (home: AccountHome) => boolean
  running: (home: AccountHome) => Promise<number>
  stopDaemon: (home: AccountHome) => Promise<void>
  onChange: () => void
  onError: (error: unknown) => void
}

// The transient daemon of an account folder keeps the config it read at start,
// so a changed share reaches new sessions only after that daemon is restarted.
export class DaemonRefresh {
  private readonly stale = new Set<string>()

  constructor(private readonly options: DaemonRefreshOptions) {}

  pending(key: string): boolean {
    return this.stale.has(key)
  }

  async prepare(home: AccountHome): Promise<void> {
    if (home.global) return
    const changed = this.options.share(home)
    if (!changed && !this.stale.has(home.key)) return
    const wasStale = this.stale.has(home.key)
    this.stale.add(home.key)
    try {
      if ((await this.options.running(home)) === 0) {
        await this.options.stopDaemon(home)
        this.stale.delete(home.key)
      }
    } catch (error) {
      this.options.onError(error)
    }
    if (this.stale.has(home.key) !== wasStale) this.options.onChange()
  }
}
