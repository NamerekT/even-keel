import type { LongToken } from '../../src/account/model.js'
import { t } from './i18n/index.js'
import { formatDay } from './stats/period.js'

/** How long before its last day a long token starts asking for a new one. */
const REMIND_MS = 30 * 24 * 3600_000

export type TokenState = 'refused' | 'over' | 'ending' | 'fine'

/** Where a long token stands: refused by the provider, past its last day, within a month of it, or fine. */
export function tokenState(token: LongToken, now: Date): TokenState {
  if (token.refusedAt !== undefined) return 'refused'
  if (token.until === null) return 'fine'
  const left = Date.parse(token.until) - now.getTime()
  return left <= 0 ? 'over' : left <= REMIND_MS ? 'ending' : 'fine'
}

/** The token's last day in the reader's own time zone; null for a token set up by hand, whose day nobody knows. */
export function tokenDay(token: LongToken): string | null {
  if (token.until === null) return null
  const day = new Date(token.until)
  const pad = (value: number) => String(value).padStart(2, '0')
  return formatDay(`${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`)
}

/** The tag after the account's name: "long token", with its last day when known. */
export function tokenTag(token: LongToken): string {
  const day = tokenDay(token)
  return day === null ? t.account.longToken : t.account.longTokenUntil(day)
}

/** What is wrong with the token, in a few words for the row; null while it is fine. */
export function tokenShort(token: LongToken, now: Date): string | null {
  const state = tokenState(token, now)
  if (state === 'refused') return t.account.tokenRefusedShort
  if (state === 'over') return t.account.tokenOverShort
  return state === 'ending' ? t.account.tokenEndingShort : null
}

/** The same with what to do, for the band of problems. */
export function tokenProblem(token: LongToken, now: Date): string | null {
  const state = tokenState(token, now)
  const day = tokenDay(token) ?? ''
  if (state === 'refused') return t.account.tokenRefused
  if (state === 'over') return t.account.tokenOver(day)
  return state === 'ending' ? t.account.tokenEnding(day) : null
}
