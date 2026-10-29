import type { AccountHome } from '../account/homes.js'
import { fail } from '../notice/notice.js'
import { pathKey } from '../paths.js'

/** Synchronous ownership closes the gap between checking liveness and launching a process. */
export class AccountLease {
  private readonly checks = new Set<string>()
  private readonly sessions = new Map<string, number>()

  constructor(private readonly label: (home: AccountHome) => string = home => home.key) {}

  held(home: AccountHome): boolean { return this.checks.has(pathKey(home.dir)) }

  reserve(home: AccountHome): (() => void) | undefined {
    const key = pathKey(home.dir)
    if (this.checks.has(key) || this.sessions.has(key)) return undefined
    this.checks.add(key)
    return () => { this.checks.delete(key) }
  }

  async session<T>(home: AccountHome, run: () => Promise<T>): Promise<T> {
    const key = pathKey(home.dir)
    if (this.checks.has(key)) throw fail('cliCheck.busy', { account: this.label(home) })
    this.sessions.set(key, (this.sessions.get(key) ?? 0) + 1)
    try { return await run() } finally {
      const left = this.sessions.get(key)! - 1
      if (left === 0) this.sessions.delete(key)
      else this.sessions.set(key, left)
    }
  }
}
