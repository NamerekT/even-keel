import { readFile } from 'node:fs/promises'
import type { AccountHome } from '../account/homes.js'
import { currentLimits, limitsFileDir, newestLimits, parseLimitsFile, type RateLimits } from './model.js'
import { parseUsage, type UsageHealth } from './usage.js'

export interface LimitsWatcherOptions {
  file: string
  intervalMs: number
  homes: () => AccountHome[]
  ownerOf: (configDir: string | null) => string | undefined
  usage: (home: AccountHome) => Promise<string>
  usageIntervalMs: number
  notBefore: (account: string) => string | null
  accessExpired: (home: AccountHome) => boolean
  onChange: () => void
  onError: (error: unknown) => void
}

interface AccountLimits {
  received: RateLimits | undefined
  polled: RateLimits | undefined
  health: UsageHealth
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
    void this.pollAll().finally(() => {
      this.usageRunning = false
      if (this.usageOff !== undefined) return
      if (this.usageAgain) {
        this.usageAgain = false
        this.refresh()
      } else this.usageTimer = setTimeout(() => this.refresh(), this.options.usageIntervalMs)
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

  private async pollAll(): Promise<void> {
    const homes = this.options.homes()
    const keys = new Set(homes.map((home) => home.key))
    for (const key of this.accounts.keys()) if (!keys.has(key)) this.accounts.delete(key)
    for (const home of homes) {
      if (this.usageOff !== undefined) break
      await this.poll(home)
    }
    this.publish()
  }

  private async poll(home: AccountHome): Promise<void> {
    const account = this.of(home.key)
    const at = new Date().toISOString()
    let answer
    try {
      answer = parseUsage(await this.options.usage(home), at)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      answer = { kind: 'unknown' as const, reason: `the call failed: ${message.trim().slice(0, 200)}` }
    }
    if (answer.kind === 'spent') {
      this.usageOff = { state: 'off', reason: answer.reason, since: at }
      for (const each of this.accounts.values()) each.polled = undefined
      this.options.onError(new Error(`${OFF_REASON_PREFIX} (${answer.reason}, ${home.key}); /usage polling is off until restart`))
    } else if (answer.kind === 'missing') {
      account.polled = undefined
      setHealth(account, 'stale', answer.reason, at)
    } else if (answer.kind === 'unknown') {
      account.polled = undefined
      if (this.options.accessExpired(home)) {
        setHealth(account, 'stale', null, at)
        return
      }
      if (account.health.state !== 'unread' || account.health.reason !== answer.reason) {
        this.options.onError(new Error(`claude -p /usage in ${home.key} answered without readable limits: ${answer.reason}`))
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
      known = { received: undefined, polled: undefined, health: WAITING }
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

function setHealth(account: AccountLimits, state: UsageHealth['state'], reason: string | null, at: string): void {
  if (account.health.state === state && account.health.reason === reason) return
  account.health = { state, reason, since: at }
}
