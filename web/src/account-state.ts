import type { AccountEntry, AccountLogin, AccountView } from '../../src/account/model.js'
import { accountName } from './accountName.js'
import { t } from './i18n/index.js'

export interface AccountBadge {
  kind: 'in' | 'out' | 'login' | 'unknown'
  label: string
}

/** The header's badge of the active account: a sign-in shows on it only when it is into that folder, not a new account's. */
export function accountBadge(view: AccountView): AccountBadge {
  const active = view.accounts.find((entry) => entry.key === view.active)
  return active === undefined ? { kind: 'unknown', label: 'Claude' } : entryBadge(active, view.login, view.accounts)
}

/** The badge of one account: only a sign-in into this very folder shows on it; its name is `accountName`'s, an e-mail's local part only. */
export function entryBadge(entry: AccountEntry, login: AccountLogin | null, accounts: AccountEntry[] = [entry]): AccountBadge {
  if (login !== null && login.target === entry.key) {
    return login.error === null ? { kind: 'login', label: t.account.loggingIn } : { kind: 'out', label: t.account.loginFailed }
  }
  const name = accountName(entry, accounts)
  if (entry.status == null) return { kind: 'unknown', label: name }
  if (entry.needsLogin) return { kind: 'out', label: t.account.needsLogin }
  return { kind: 'in', label: entry.name === null && name === entry.status.email ? name.split('@')[0]! : name }
}

/** The accounts the header shows: the one holding the Even Keel role, then every other one a project runs on. */
export function headerAccounts(view: AccountView): AccountEntry[] {
  const active = view.accounts.find((entry) => entry.key === view.active)
  const others = view.accounts.filter((entry) => entry.key !== view.active && entry.projects.length > 0)
  return active === undefined ? others : [active, ...others]
}

const DAY_MS = 24 * 60 * 60_000
const RENEW_WITHIN_DAYS = 7

export function loginLeft(expiresAt: string | null, now: Date): { text: string; renew: boolean } {
  if (expiresAt === null) return { text: '—', renew: false }
  const left = Date.parse(expiresAt) - now.getTime()
  if (left <= 0) return { text: t.account.expired, renew: true }
  const days = Math.floor(left / DAY_MS)
  return { text: days === 0 ? t.account.underDay : t.account.days(days), renew: days < RENEW_WITHIN_DAYS }
}

export function limitedUntil(entry: AccountEntry, now: Date): string | null {
  const spent = [entry.limits?.fiveHour, entry.limits?.sevenDay, entry.limits?.month]
    .filter((window) => window != null && window.usedPercentage >= 100 && Date.parse(window.resetsAt) > now.getTime())
    .map((window) => window!.resetsAt)
  return spent.length === 0 ? null : spent.reduce((later, each) => (Date.parse(each) > Date.parse(later) ? each : later))
}

export function canWork(entry: AccountEntry, now: Date): boolean {
  return entry.status?.loggedIn === true && !entry.needsLogin && !entry.removing && limitedUntil(entry, now) === null
}

export function accountOrder(entries: AccountEntry[], now: Date): AccountEntry[] {
  return [...entries.filter((entry) => canWork(entry, now)), ...entries.filter((entry) => !canWork(entry, now))]
}
