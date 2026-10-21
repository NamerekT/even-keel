import { readFile } from 'node:fs/promises'
import type { AccountHome } from '../account/homes.js'
import { currentLimits, limitsFileDir, newestLimits, parseLimitsFile, type RateLimits } from './model.js'
import { englishOf, notice, sameNotice, type Notice } from '../notice/notice.js'
import type { UsageAnswer, UsageHealth } from './usage.js'

export interface LimitsWatcherOptions {
  file: string
  intervalMs: number
  homes: () => AccountHome[]
  ownerOf: (configDir: string | null) => string | undefined
  /** How the account's usage is asked for (`Agent.usage`); `undefined` — its agent cannot tell, and it is not polled. */
  usage: (home: AccountHome) => ((at: string) => Promise<UsageAnswer>) | undefined
  usageIntervalMs: number
  /** Whether the account's provider answers: a call made before it may renew the sign-in into the void (EKR-15). */
  online: (home: AccountHome) => Promise<boolean>
  /** How soon a round that skipped an account for the network comes again. */
  offlineRetryMs: number
  notBefore: (account: string) => string | null
  accessExpired: (home: AccountHome) => boolean
  /** An API account has no usage windows: it is not polled and shows no limits. */
  apiKey: (account: string) => boolean
  onChange: () => void
  onError: (error: unknown) => void
}

interface AccountLimits {
  received: RateLimits | undefined
  polled: RateLimits | undefined
  health: UsageHealth
  /** Failed calls in a row. */
  failures: number
}

const WAITING: UsageHealth = { state: 'waiting', reason: null, since: null }
const OFF_REASON_PREFIX = 'claude -p /usage may have reached the model'

export class LimitsWatcher {
  private readonly accounts = new Map<string, AccountLimits>()
  private shown = ''
  private timer: NodeJS.Timeout | undefined
  private usageTimer: NodeJS.Timeout | undefined
  private usageRunning = false
  private usageAgain = false
  private usageOff: UsageHealth | undefined

  constructor(private readonly options: LimitsWatcherOptions) {}

  limits(account: string): RateLimits | null {
    if (this.options.apiKey(account)) return null
    const known = this.accounts.get(account)
    return currentLimits(newestLimits(known?.received, known?.polled), new Date(), this.options.notBefore(account))
  }

  usage(account: string): UsageHealth {
    return this.usageOff ?? this.accounts.get(account)?.health ?? WAITING
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
    if (this.usageOff !== undefined) return
    if (this.usageRunning) {
      this.usageAgain = true
      return
    }
    clearTimeout(this.usageTimer)
    this.usageRunning = true
    let skipped = false
    void this.pollAll()
      .then((offline) => void (skipped = offline))
      .finally(() => {
        this.usageRunning = false
        if (this.usageOff !== undefined) return
        if (this.usageAgain) {
          this.usageAgain = false
          this.refresh()
        } else this.usageTimer = setTimeout(() => this.refresh(), skipped ? this.options.offlineRetryMs : this.options.usageIntervalMs)
      })
  }

  private async tick(): Promise<void> {
    try {
      const raw: unknown = JSON.parse(await readFile(this.options.file, 'utf8'))
      const parsed = parseLimitsFile(raw)
      const owner = this.options.ownerOf(limitsFileDir(raw))
      if (parsed !== undefined && owner !== undefined) this.of(owner).received = parsed
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) this.options.onError(error)
    }
    this.publish()
  }

  /** True when an account was skipped because its provider did not answer. */
  private async pollAll(): Promise<boolean> {
    const homes = this.options.homes().filter((home) => !this.options.apiKey(home.key) && this.options.usage(home) !== undefined)
    const keys = new Set(homes.map((home) => home.key))
    for (const key of this.accounts.keys()) if (!keys.has(key)) this.accounts.delete(key)
    let skipped = false
    for (const home of homes) {
      if (this.usageOff !== undefined) break
      if (!(await this.options.online(home))) {
        skipped = true
        continue
      }
      await this.poll(home)
    }
    this.publish()
    return skipped
  }

  private async poll(home: AccountHome): Promise<void> {
    const account = this.of(home.key)
    const at = new Date().toISOString()
    let answer: UsageAnswer
    try {
      answer = await this.options.usage(home)!(at)
      account.failures = 0
    } catch (error) {
      const detail = (error instanceof Error ? error.message : String(error)).trim().slice(0, 200)
      // A lone failure is usually the network: what was known stays until the next poll fails too.
      if (++account.failures < 2) {
        this.options.onError(new Error(`claude -p /usage in ${home.key} failed, retrying at the next poll: ${detail}`))
        return
      }
      answer = { kind: 'unknown', reason: notice('usage.callFailed', {}, { detail }) }
    }
    if (answer.kind === 'spent') {
      this.usageOff = { state: 'off', reason: answer.reason, since: at }
      for (const each of this.accounts.values()) each.polled = undefined
      this.options.onError(new Error(`${OFF_REASON_PREFIX} (${englishOf(answer.reason)}, ${home.key}); /usage polling is off until restart`))
    } else if (answer.kind === 'missing') {
      account.polled = undefined
      setHealth(account, 'stale', answer.reason, at)
    } else if (answer.kind === 'unknown') {
      account.polled = undefined
      if (this.options.accessExpired(home)) {
        setHealth(account, 'stale', null, at)
        return
      }
      if (account.health.state !== 'unread' || !sameNotice(account.health.reason, answer.reason)) {
        this.options.onError(new Error(`claude -p /usage in ${home.key} answered without readable limits: ${englishOf(answer.reason)}`))
      }
      setHealth(account, 'unread', answer.reason, at)
    } else {
      account.polled = answer.limits
      setHealth(account, 'ok', null, at)
    }
  }

  private of(key: string): AccountLimits {
    let known = this.accounts.get(key)
    if (known === undefined) {
      known = { received: undefined, polled: undefined, health: WAITING, failures: 0 }
      this.accounts.set(key, known)
    }
    return known
  }

  private publish(): void {
    const shown = JSON.stringify([...this.accounts.keys()].map((key) => [key, this.limits(key), this.usage(key)]))
    if (shown === this.shown) return
    this.shown = shown
    this.options.onChange()
  }
}

function setHealth(account: AccountLimits, state: UsageHealth['state'], reason: Notice | null, at: string): void {
  if (account.health.state === state && sameNotice(account.health.reason, reason)) return
  account.health = { state, reason, since: at }
}
