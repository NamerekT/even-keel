import { sameJson } from '../machine/facts.js'
import { newestLimits, type RateLimits } from './model.js'
import { tokenWindowsDiffer } from './token-windows.js'

/** What a machine says of one of its account folders (`MachineFacts.identities`, `docs/machines.md`, "Account limits"). */
export interface AccountTie {
  /** `oauthAccount.accountUuid` of the folder's `.claude.json`: the same account on two machines is one. */
  account: string
  email: string | null
  /** The folder's limits could be polled here: a full sign-in, not a long token, not signed out. */
  polls: boolean
  /** The machine does not poll it, as its hub told (`LimitsPlan.skip`). */
  skipped?: true
}

/**
 * What the machine says of a Claude folder: the account of its full sign-in, else the hub's account its long token was
 * said to be of (BTN-1002) — `auth status` on a token names none; `undefined` — neither is known.
 */
export function accountTie(
  signed: { account: string; email: string | null } | undefined,
  token: { account: string; email: string | null } | undefined,
  polls: boolean,
  skipped: boolean,
): AccountTie | undefined {
  const of = signed ?? token
  if (of === undefined) return undefined
  return { account: of.account, email: of.email, polls, ...(skipped && { skipped: true as const }) }
}

/** What the hub tells a machine of its account folders (the command `limits.plan`); a part left out did not change. */
export interface LimitsPlan {
  /** The folders whose account another machine polls: the whole list. */
  skip?: string[]
  /** By folder, the newest limits another machine told of the folder's account. */
  picture?: Record<string, RateLimits>
}

/** A machine as the hub's mirror has it. */
export interface MachineAccounts {
  machine: string
  online: boolean
  identities: Record<string, AccountTie>
  /** By folder, as the machine posted them. */
  limits: Record<string, RateLimits | null>
}

export interface SharedAccount {
  account: string
  email: string | null
  machines: string[]
}

interface Told {
  skip: string[] | undefined
  /** By folder, the time of the limits the machine was handed last. */
  picture: Map<string, number>
}

export interface AccountPollsOptions {
  /** The hub's own machine: it polls every account signed in on it. */
  hub: () => string
  log: (line: string) => void
}

export const LIMITS_PLAN_COMMAND = 'limits.plan'

/**
 * The hub's picture of the accounts' limits (BTN-991): one machine polls `/usage` per account — the hub when the
 * account has a full sign-in there, otherwise one machine on the link, kept while it stays there — and the hub hands
 * the others the newest limits any machine told of the account.
 */
export class AccountPolls {
  private readonly pollers = new Map<string, string>()
  private readonly told = new Map<string, Told>()
  private sharedNow: SharedAccount[] = []
  /** The accounts whose long-token windows differ from their full sign-in's poll (BTN-1267). */
  private readonly differing = new Set<string>()

  constructor(private readonly options: AccountPollsOptions) {}

  /** The machine that polls the account; `undefined` — no machine on the link can. */
  poller(account: string): string | undefined {
    return this.pollers.get(account)
  }

  /** The accounts signed in on more than one machine: their limit window is one. */
  shared(): SharedAccount[] {
    return this.sharedNow
  }

  /** A long token's session windows of the account differ from its full sign-in's poll: the hub hands on the poll alone. */
  differs(account: string): boolean {
    return this.differing.has(account)
  }

  /** A new connection of the machine: what it was told before is not known to hold any more. */
  connected(machine: string): void {
    this.told.delete(machine)
  }

  /** What each machine on the link must be told now; a machine with nothing new is not in the map. */
  plan(machines: MachineAccounts[]): Map<string, LimitsPlan> {
    this.choose(machines)
    this.warn(machines)
    this.compare(machines)
    const plans = new Map<string, LimitsPlan>()
    for (const each of machines) {
      if (!each.online) continue
      const plan = this.planOf(each, machines)
      if (plan.skip !== undefined || plan.picture !== undefined) plans.set(each.machine, plan)
    }
    return plans
  }

  private choose(machines: MachineAccounts[]): void {
    const candidates = new Map<string, string[]>()
    for (const each of machines) {
      if (!each.online) continue
      for (const tie of Object.values(each.identities)) {
        if (!tie.polls) continue
        const list = candidates.get(tie.account) ?? []
        if (!list.includes(each.machine)) list.push(each.machine)
        candidates.set(tie.account, list)
      }
    }
    for (const account of [...this.pollers.keys()]) if (!candidates.has(account)) this.pollers.delete(account)
    const hub = this.options.hub()
    for (const [account, list] of candidates) {
      const was = this.pollers.get(account)
      const now = list.includes(hub) ? hub : was !== undefined && list.includes(was) ? was : [...list].sort()[0]!
      if (now === was) continue
      this.pollers.set(account, now)
      if (now !== hub) this.options.log(`limits: machine ${now} polls the limits of ${this.nameOf(account, machines)}`)
    }
  }

  private planOf(target: MachineAccounts, machines: MachineAccounts[]): LimitsPlan {
    const told = this.told.get(target.machine) ?? { skip: undefined, picture: new Map<string, number>() }
    this.told.set(target.machine, told)
    const plan: LimitsPlan = {}
    const folders = Object.entries(target.identities)
    const skip = folders
      .filter(([, tie]) => tie.polls && this.pollers.has(tie.account) && this.pollers.get(tie.account) !== target.machine)
      .map(([folder]) => folder)
      .sort()
    // A machine that connected anew is always told, an empty list too: one on the network waits for it before its first poll.
    if (told.skip === undefined ? target.machine !== this.options.hub() : !sameJson(skip, told.skip)) plan.skip = skip
    told.skip = skip
    for (const [folder, tie] of folders) {
      const newest = this.newestElsewhere(tie.account, target.machine, machines)
      if (newest === undefined) continue
      const at = Date.parse(newest.updatedAt)
      const own = target.limits[folder]
      if (at <= (told.picture.get(folder) ?? -Infinity) || (own != null && at <= Date.parse(own.updatedAt))) continue
      ;(plan.picture ??= {})[folder] = newest
      told.picture.set(folder, at)
    }
    return plan
  }

  private newestElsewhere(account: string, machine: string, machines: MachineAccounts[]): RateLimits | undefined {
    let newest: RateLimits | undefined
    for (const other of machines) {
      if (other.machine === machine) continue
      for (const [folder, tie] of Object.entries(other.identities)) {
        const told = other.limits[folder] ?? undefined
        if (tie.account !== account || (told !== undefined && this.differing.has(account) && tokenReading(tie, told))) continue
        newest = newestLimits(newest, told)
      }
    }
    return newest
  }

  /**
   * A long token's session windows against the newest poll of the account's full sign-in (BTN-1267): the account stays
   * as the last pair that could be compared left it, so a token folder's echo of the poll changes nothing.
   */
  private compare(machines: MachineAccounts[]): void {
    const polled = new Map<string, { limits: RateLimits; machine: string }>()
    for (const each of machines) {
      for (const [folder, tie] of Object.entries(each.identities)) {
        const told = each.limits[folder]
        if (!tie.polls || told?.source !== 'usage') continue
        const was = polled.get(tie.account)
        if (was === undefined || Date.parse(told.updatedAt) > Date.parse(was.limits.updatedAt)) polled.set(tie.account, { limits: told, machine: each.machine })
      }
    }
    const verdicts = new Map<string, { machine: string; span: string } | null>()
    for (const each of machines) {
      for (const [folder, tie] of Object.entries(each.identities)) {
        const told = each.limits[folder]
        const poll = polled.get(tie.account)
        if (told == null || poll === undefined || !tokenReading(tie, told)) continue
        const span = tokenWindowsDiffer(told, poll.limits)
        if (span !== undefined) verdicts.set(tie.account, { machine: each.machine, span })
        else if (!verdicts.has(tie.account)) verdicts.set(tie.account, null)
      }
    }
    for (const [account, verdict] of verdicts) {
      const name = this.nameOf(account, machines)
      if (verdict !== null && !this.differing.has(account)) {
        this.differing.add(account)
        this.options.log(
          `limits: the ${verdict.span} window of ${name}'s long token on machine ${verdict.machine} differs from its full sign-in's poll on machine ${polled.get(account)!.machine}: the full sign-in's poll is taken, the token's windows are not handed to other machines`,
        )
      } else if (verdict === null && this.differing.delete(account)) {
        this.options.log(`limits: the long-token windows of ${name} agree again with its full sign-in's poll`)
      }
    }
  }

  private warn(machines: MachineAccounts[]): void {
    const by = new Map<string, SharedAccount>()
    for (const each of machines) {
      for (const tie of Object.values(each.identities)) {
        const entry = by.get(tie.account) ?? { account: tie.account, email: tie.email, machines: [] }
        if (!entry.machines.includes(each.machine)) entry.machines.push(each.machine)
        by.set(tie.account, entry)
      }
    }
    const shared = [...by.values()].filter((entry) => entry.machines.length > 1).map((entry) => ({ ...entry, machines: entry.machines.sort() }))
    for (const entry of shared) {
      const before = this.sharedNow.find((each) => each.account === entry.account)
      if (before !== undefined && sameJson(before.machines, entry.machines)) continue
      this.options.log(`limits: ${entry.email ?? entry.account} is signed in on machines ${entry.machines.join(', ')}: they share one limit window`)
    }
    this.sharedNow = shared
  }

  private nameOf(account: string, machines: MachineAccounts[]): string {
    for (const each of machines) for (const tie of Object.values(each.identities)) if (tie.account === account && tie.email !== null) return tie.email
    return account
  }
}

/** What a long-token folder's own sessions told, not the poll it was handed and posted back. */
function tokenReading(tie: AccountTie, limits: RateLimits): boolean {
  return !tie.polls && limits.source === 'sdk'
}
