import { readFile } from 'node:fs/promises'
import type { AccountHome } from '../account/homes.js'
import { currentLimits, limitsFileDir, newestLimits, parseLimitsFile, withMonthSpent, withSessionLimits, type RateLimits, type SessionLimits } from './model.js'
import { englishOf, notice, sameNotice, type Notice } from '../notice/notice.js'
import type { LimitsPlan } from './polls.js'
import type { UsageAnswer, UsageHealth } from './usage.js'

export interface LimitsWatcherOptions {
  file: string
  intervalMs: number
  homes: () => AccountHome[]
  ownerOf: (configDir: string | null) => string | undefined
  /** How the account's usage is asked for (`Agent.usage`); `undefined` — its agent cannot tell, and it is not polled. */
  usage: (home: AccountHome) => ((at: string) => Promise<UsageAnswer>) | undefined
  /** A poll cannot read the account's limits, told without the network (`Agent.limitsHidden`): a chain does not wait for it. */
  limitsHidden?: (home: AccountHome) => boolean
  usageIntervalMs: number
  /** Whether the account's provider answers: a call made before it may renew the sign-in into the void (EKR-15). */
  online: (home: AccountHome) => Promise<boolean>
  /** How soon a round that skipped an account for the network comes again. */
  offlineRetryMs: number
  notBefore: (account: string) => string | null
  accessExpired: (home: AccountHome) => boolean
  /** The accounts' statuses have been read: until then `apiKey` cannot tell, and /usage is not asked. */
  ready: () => boolean
  /** An API account has no usage windows: it is not polled and shows no limits. */
  apiKey: (account: string) => boolean
  /** A signed-out folder is not asked for limits; its account card already asks for sign-in. */
  needsLogin: (account: string) => boolean
  /**
   * A folder on a long token (BTN-1005): `/usage` gives it no limits, so it is never polled and shows what its sessions
   * tell; with `sameAs` — the folder with a full sign-in of the same account, whose limits it shows and feeds.
   */
  longToken?: (account: string) => { sameAs?: string | undefined } | undefined
  /** The limits a poll or a session last told of each account before the restart (`account_limits`, BTN-631). */
  saved?: ReadonlyMap<string, RateLimits>
  /** Keeps the newest of what polls and sessions told; `undefined` — nothing is known any more. */
  save?: (account: string, limits: RateLimits | undefined) => void
  /** A machine on the network (BTN-1247): no /usage round before the hub's first `plan`, or it may poll what another machine polls. */
  planFirst?: boolean
  onChange: () => void
  onError: (error: unknown) => void
}

interface AccountLimits {
  received: RateLimits | undefined
  polled: RateLimits | undefined
  /** From the `rate_limit_event`s of the account's SDK sessions. */
  streamed: RateLimits | undefined
  /** What the hub handed over from the account's other machines (`plan`). */
  hub: RateLimits | undefined
  /** The month a session's refusal spent, until a poll tells (`spendMonth`). */
  refused: RateLimits | undefined
  health: UsageHealth
  /** Failed calls in a row. */
  failures: number
}

const WAITING: UsageHealth = { state: 'waiting', reason: null, since: null }
/** A folder never polled reads its limits from its sessions: nothing is missing. */
const FROM_SESSIONS: UsageHealth = { state: 'ok', reason: null, since: null }
/** A folder another machine polls: its limits come from the hub. */
const FROM_HUB: UsageHealth = FROM_SESSIONS
const OFF_REASON_PREFIX = 'claude -p /usage may have reached the model'

export class LimitsWatcher {
  private readonly accounts = new Map<string, AccountLimits>()
  private shown = ''
  private timer: NodeJS.Timeout | undefined
  /** Set at once by `start`: `timer` comes only after the first read of the limits file. */
  private started = false
  private usageTimer: NodeJS.Timeout | undefined
  private usageRunning = false
  private usageAgain = false
  private usageOff: UsageHealth | undefined
  private waitsForAccounts = false
  private nextAt: string | null = null
  /** What `save` was last given per account, as JSON. */
  private readonly kept = new Map<string, string>()
  /** The folders whose account another machine polls, as the hub told. */
  private skip = new Set<string>()
  /** A folder the hub gave back is polled no sooner than a poll interval after: its poller may have just polled it. */
  private readonly resumeAt = new Map<string, number>()
  private awaitsPlan: boolean

  constructor(private readonly options: LimitsWatcherOptions) {
    this.awaitsPlan = options.planFirst === true
    // A saved session report goes back where it came from, so a poll's own rules (`missing` drops `polled`) stay as before.
    for (const [key, limits] of options.saved ?? []) {
      this.of(key)[limits.source === 'sdk' ? 'streamed' : 'polled'] = limits
      this.kept.set(key, JSON.stringify(limits))
    }
  }

  /** A long-token folder's account with a full sign-in elsewhere: its limits live under that folder. */
  private sameAs(account: string): string | undefined {
    return this.options.longToken?.(account)?.sameAs
  }

  private sessionsOnly(account: string): boolean {
    return this.options.longToken?.(account) !== undefined
  }

  limits(account: string): RateLimits | null {
    const same = this.sameAs(account)
    if (same !== undefined) return this.limits(same)
    if (this.options.apiKey(account)) return null
    const now = new Date()
    const own = currentLimits(newestOf(this.accounts.get(account)), now, this.options.notBefore(account))
    if (!own?.pool?.startsWith('chatgpt:')) return own
    let shared = own
    for (const [key, known] of this.accounts) {
      if (key === account || this.options.apiKey(key) || this.options.needsLogin(key)) continue
      const other = currentLimits(newestOf(known), now, this.options.notBefore(key))
      if (other?.pool === own.pool) shared = newestLimits(shared, other)!
    }
    return currentLimits(shared, now, this.options.notBefore(account))
  }

  /** The windows a session of the account reported between the polls, over the newest of what was known. */
  report(account: string, reported: SessionLimits, at = new Date().toISOString()): void {
    const known = this.of(this.sameAs(account) ?? account)
    known.streamed = withSessionLimits(newestOf(known), reported, at)
    this.publish()
  }

  /** A session of the account was refused for the spent month at `at`: it shows spent until a newer poll. */
  spendMonth(account: string, at: string): void {
    const known = this.accounts.get(account)
    const spent = withMonthSpent(newestOf(known), at)
    if (known === undefined || spent === undefined) return
    known.refused = spent
    this.publish()
  }

  /**
   * What the hub tells of the account folders (`docs/machines.md`, "Account limits"): which ones another machine polls,
   * and the newest limits the account's other machines told.
   */
  plan(plan: LimitsPlan): void {
    if (plan.skip !== undefined) {
      const skip = new Set(plan.skip)
      for (const key of this.skip) if (!skip.has(key)) this.resumeAt.set(key, Date.now() + this.options.usageIntervalMs)
      for (const key of skip) this.resumeAt.delete(key)
      this.skip = skip
    }
    for (const [key, limits] of Object.entries(plan.picture ?? {})) {
      const known = this.of(key)
      known.hub = newestLimits(known.hub, limits)
    }
    this.publish()
    if (this.awaitsPlan) {
      this.awaitsPlan = false
      if (this.started) this.refresh()
    }
  }

  skipped(account: string): boolean {
    return this.skip.has(account)
  }

  /** The folder's limits could be polled here, whatever the hub said: the hub picks its poller among such folders. */
  pollable(account: string): boolean {
    const home = this.options.homes().find((each) => each.key === account)
    return home !== undefined && this.polled(home)
  }

  usage(account: string): UsageHealth {
    const same = this.sameAs(account)
    if (same !== undefined) return this.usage(same)
    if (this.options.needsLogin(account) || this.options.apiKey(account)) return WAITING
    if (this.sessionsOnly(account)) return FROM_SESSIONS
    if (this.skip.has(account)) return FROM_HUB
    return this.usageOff ?? this.accounts.get(account)?.health ?? WAITING
  }

  /**
   * The account is polled and no poll has answered since the start: a spent window still looks like none. What a poll or
   * a session told before the restart stands in for the first poll while it is younger than a poll's interval (BTN-631),
   * as it would between two polls.
   */
  unread(account: string): boolean {
    if (!this.unconfirmed(account)) return false
    const known = this.accounts.get(account)
    const told = currentLimits(newestLimits(newestLimits(known?.polled, known?.streamed), known?.hub), new Date(), this.options.notBefore(account))
    return told === null || !this.recent(told)
  }

  /** The account shows limits older than a poll's interval that no poll has confirmed since the start (BTN-631). */
  outdated(account: string): boolean {
    if (!this.unconfirmed(account)) return false
    const shown = this.limits(account)
    return shown !== null && !this.recent(shown)
  }

  /** When the next /usage round is due; `null` — one is running, none is planned, or it waits for the accounts. */
  nextPoll(): string | null {
    return this.nextAt
  }

  start(): void {
    if (this.started) return
    this.started = true
    const tick = () => {
      void this.tick().finally(() => {
        this.timer = setTimeout(tick, this.options.intervalMs)
      })
    }
    tick()
    this.refresh()
  }

  /** A poll waits for the accounts to be read: the caller refreshes once they are. */
  get deferred(): boolean {
    return this.waitsForAccounts
  }

  refresh(): void {
    if (this.usageOff !== undefined || this.awaitsPlan) return
    this.waitsForAccounts = !this.options.ready()
    if (this.waitsForAccounts) return
    if (this.usageRunning) {
      this.usageAgain = true
      return
    }
    clearTimeout(this.usageTimer)
    this.usageRunning = true
    this.nextAt = null
    let skipped = false
    void this.pollAll()
      .then((offline) => void (skipped = offline))
      .finally(() => {
        this.usageRunning = false
        if (this.usageOff !== undefined) return
        if (this.usageAgain) {
          this.usageAgain = false
          this.refresh()
          return
        }
        const delay = skipped ? this.options.offlineRetryMs : this.options.usageIntervalMs
        this.usageTimer = setTimeout(() => this.refresh(), delay)
        this.nextAt = new Date(Date.now() + delay).toISOString()
        this.publish()
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
    const homes = this.options.homes().filter((home) => this.polled(home))
    const keys = new Set(homes.map((home) => home.key))
    for (const home of this.options.homes()) if (this.sessionsOnly(home.key) && !this.options.needsLogin(home.key)) keys.add(home.key)
    for (const key of this.accounts.keys()) if (!keys.has(key)) this.accounts.delete(key)
    let skipped = false
    for (const home of homes) {
      if (this.usageOff !== undefined) break
      if (this.skip.has(home.key) || (this.resumeAt.get(home.key) ?? 0) > Date.now()) continue
      this.resumeAt.delete(home.key)
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
    if (this.options.needsLogin(home.key)) return
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
        this.options.onError(new Error(`the usage poll of ${home.key} failed, retrying at the next poll: ${detail}`))
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
        this.options.onError(new Error(`the usage poll of ${home.key} answered without readable limits: ${englishOf(answer.reason)}`))
      }
      setHealth(account, 'unread', answer.reason, at)
    } else {
      // A fallback (Codex reads its rollouts when ChatGPT does not answer) may be older than the last poll.
      account.polled = newestLimits(answer.limits, account.polled)
      setHealth(account, 'ok', answer.reason ?? null, at)
    }
  }

  /** A polled account that no poll has answered since the start. */
  private unconfirmed(account: string): boolean {
    const same = this.sameAs(account)
    if (same !== undefined) return this.unconfirmed(same)
    if (this.sessionsOnly(account) || this.skip.has(account)) return false
    if (this.usageOff !== undefined || this.options.needsLogin(account) || this.options.apiKey(account)) return false
    const home = this.options.homes().find((each) => each.key === account)
    if (home === undefined || this.options.usage(home) === undefined || this.options.limitsHidden?.(home) === true) return false
    return (this.accounts.get(account)?.health ?? WAITING).state === 'waiting'
  }

  /** The round polls the folder unless the hub said another machine does. */
  private polled(home: AccountHome): boolean {
    return !this.options.needsLogin(home.key) && !this.options.apiKey(home.key) && !this.sessionsOnly(home.key) && this.options.usage(home) !== undefined
  }

  private recent(limits: RateLimits): boolean {
    return Date.now() - Date.parse(limits.updatedAt) <= this.options.usageIntervalMs
  }

  /** Hands `save` the newest of what polls and sessions told, for each account where it changed. */
  private keep(): void {
    const { save } = this.options
    if (save === undefined) return
    for (const key of new Set([...this.kept.keys(), ...this.accounts.keys()])) {
      const known = this.accounts.get(key)
      const latest = newestLimits(known?.polled, known?.streamed)
      const text = latest === undefined ? undefined : JSON.stringify(latest)
      if (text === this.kept.get(key)) continue
      if (text === undefined) this.kept.delete(key)
      else this.kept.set(key, text)
      save(key, latest)
    }
  }

  private of(key: string): AccountLimits {
    let known = this.accounts.get(key)
    if (known === undefined) {
      known = { received: undefined, polled: undefined, streamed: undefined, hub: undefined, refused: undefined, health: WAITING, failures: 0 }
      this.accounts.set(key, known)
    }
    return known
  }

  private publish(): void {
    this.keep()
    // The next poll's time matters only to a chain waiting for a first answer (BTN-619).
    const next = this.options.homes().some((home) => this.unread(home.key)) ? this.nextAt : null
    const shown = JSON.stringify([next, ...[...this.accounts.keys()].map((key) => [key, this.limits(key), this.usage(key), this.outdated(key)])])
    if (shown === this.shown) return
    this.shown = shown
    this.options.onChange()
  }
}

function setHealth(account: AccountLimits, state: UsageHealth['state'], reason: Notice | null, at: string): void {
  if (account.health.state === state && sameNotice(account.health.reason, reason)) return
  account.health = { state, reason, since: at }
}

function newestOf(known: AccountLimits | undefined): RateLimits | undefined {
  return newestLimits(newestLimits(newestLimits(newestLimits(known?.received, known?.polled), known?.streamed), known?.hub), known?.refused)
}
