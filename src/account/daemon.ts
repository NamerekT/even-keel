import type { AccountHome } from './homes.js'

/** The version an account's daemon runs and the one its sessions are pinned to (BTN-250). */
export interface DaemonVersion {
  running: string
  wanted: string
}

/** An account folder whose daemon runs another version than the pinned one: its sessions run on `running`. */
export interface OutdatedDaemon extends DaemonVersion {
  account: string
  agent: string
}

export interface DaemonRefreshOptions {
  share: (home: AccountHome) => boolean
  running: (home: AccountHome) => Promise<number>
  /** Optional. The folder's daemon against the pin; `null` — none runs, or the folder's sessions are not pinned. */
  daemon?: (home: AccountHome) => Promise<DaemonVersion | null>
  stopDaemon: (home: AccountHome) => Promise<void>
  onChange: () => void
  onError: (error: unknown) => void
}

// Sessions inherit the environment the transient daemon of an account folder started with,
// so an env key the share removed stays in new sessions until that daemon is restarted.
// They also run on the daemon's version, not on the one of the client that starts them.
export class DaemonRefresh {
  private readonly stale = new Set<string>()
  private readonly behind = new Map<string, OutdatedDaemon>()

  constructor(private readonly options: DaemonRefreshOptions) {}

  pending(key: string): boolean {
    return this.stale.has(key)
  }

  /** The daemons on another version than the pin, as of the last launch in their folder. */
  outdated(): OutdatedDaemon[] {
    return [...this.behind.values()]
  }

  async prepare(home: AccountHome): Promise<void> {
    const before = this.snapshot()
    if (!home.global && this.options.share(home)) this.stale.add(home.key)
    await this.compare(home)
    if (this.stale.has(home.key) || this.behind.has(home.key)) await this.settle(home)
    if (this.snapshot() !== before) this.options.onChange()
  }

  /** A key left the folder's settings outside the share — the page removed it from the global one (BTN-131). */
  async expire(home: AccountHome): Promise<void> {
    const before = this.snapshot()
    this.stale.add(home.key)
    await this.settle(home)
    if (this.snapshot() !== before) this.options.onChange()
  }

  private async compare(home: AccountHome): Promise<void> {
    if (this.options.daemon === undefined) return
    try {
      const daemon = await this.options.daemon(home)
      if (daemon === null || daemon.running === daemon.wanted) this.behind.delete(home.key)
      else this.behind.set(home.key, { account: home.key, agent: home.agent, ...daemon })
    } catch (error) {
      this.options.onError(error)
    }
  }

  private async settle(home: AccountHome): Promise<void> {
    try {
      if ((await this.options.running(home)) === 0) {
        await this.options.stopDaemon(home)
        this.stale.delete(home.key)
        this.behind.delete(home.key)
      }
    } catch (error) {
      this.options.onError(error)
    }
  }

  private snapshot(): string {
    return JSON.stringify([[...this.stale], [...this.behind.values()]])
  }
}
