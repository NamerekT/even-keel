import type { AccountHome } from './homes.js'

export interface DaemonRefreshOptions {
  share: (home: AccountHome) => boolean
  running: (home: AccountHome) => Promise<number>
  stopDaemon: (home: AccountHome) => Promise<void>
  onChange: () => void
  onError: (error: unknown) => void
}

// Sessions inherit the environment the transient daemon of an account folder started with,
// so an env key the share removed stays in new sessions until that daemon is restarted.
export class DaemonRefresh {
  private readonly stale = new Set<string>()

  constructor(private readonly options: DaemonRefreshOptions) {}

  pending(key: string): boolean {
    return this.stale.has(key)
  }

  async prepare(home: AccountHome): Promise<void> {
    const changed = !home.global && this.options.share(home)
    if (!changed && !this.stale.has(home.key)) return
    await this.settle(home)
  }

  /** A key left the folder's settings outside the share — the page removed it from the global one (BTN-131). */
  async expire(home: AccountHome): Promise<void> {
    await this.settle(home)
  }

  private async settle(home: AccountHome): Promise<void> {
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
