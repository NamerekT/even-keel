import type { LimitWindow } from './model.js'

/** Plans a person buys for themselves: a workspace seat (Team, Business, Edu, Enterprise) is any other. */
const PERSONAL_PLANS = new Set(['free', 'go', 'plus', 'pro'])

/**
 * Where ChatGPT's spend page reads a workspace seat's monthly credits (EKR-132): the owner's cap and what the seat used
 * this month. Asked only when `wham/usage` has no `spend_control.individual_limit` of its own (`ownSeatMonth`); Codex
 * does not ask it.
 */
export function chatGptSeatUsageUrl(accountId: string): string {
  return `https://chatgpt.com/backend-api/accounts/${encodeURIComponent(accountId)}/spend-controls/current-user/monthly-usage?supports_usage_limit_modes=true`
}

/** Whether `wham/usage` is a workspace seat's: it has `spend_control` and the plan is not a personal one. */
export function isChatGptSeat(body: unknown): boolean {
  return isRecord(body) && isRecord(body.spend_control) && typeof body.plan_type === 'string' && !PERSONAL_PLANS.has(body.plan_type)
}

/** `spend_control.reached` of `wham/usage`: the seat's monthly cap is spent; `undefined` — the answer does not say. */
export function spendCapReached(body: unknown): boolean | undefined {
  const control = isRecord(body) ? body.spend_control : undefined
  return isRecord(control) && typeof control.reached === 'boolean' ? control.reached : undefined
}

/**
 * The seat's month out of `wham/usage` itself (EKR-152): `spend_control.individual_limit` in credits, its `used` and
 * `limit` numbers in strings, its own reset. `undefined` — no such limit in credits; `monthly-usage` is asked instead.
 */
export function ownSeatMonth(body: unknown, at: string, reached: boolean): LimitWindow | undefined {
  const control = isRecord(body) ? body.spend_control : undefined
  const own = isRecord(control) ? control.individual_limit : undefined
  if (!isRecord(own) || own.unit !== 'credit') return undefined
  const used = amountOf(own.used)
  const limit = amountOf(own.limit)
  if (used === undefined || limit === undefined || limit <= 0) return undefined
  const { reset_at: resetAt, reset_after_seconds: after } = own
  const reset = typeof resetAt === 'number' && resetAt > 0 ? resetAt * 1000
    : typeof after === 'number' && after >= 0 ? Date.parse(at) + after * 1000 : NaN
  return capped(used, limit, Number.isFinite(reset) ? new Date(reset).toISOString() : nextMonth(at), reached)
}

/**
 * The seat's month out of the `monthly-usage` answer: the credits used of the cap, resetting at the next calendar month
 * in UTC (the answer names no reset; `individual_limit`'s one seen is that). Whether the seat is closed is
 * `spend_control.reached`'s to say, so the count alone stays under 100 %, and `reached` makes it 100 %. `undefined` —
 * not an answer in credits.
 */
export function seatMonth(raw: unknown, at: string, reached: boolean): LimitWindow | undefined {
  if (!isRecord(raw) || (raw.balance_unit !== undefined && raw.balance_unit !== 'credit')) return undefined
  const used = raw.current_month_usage
  if (typeof used !== 'number' || !Number.isFinite(used) || used < 0) return undefined
  const resetsAt = nextMonth(at)
  const cap = isRecord(raw.effective_monthly_limit) ? raw.effective_monthly_limit : undefined
  const limit = cap?.limit
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0 || (cap?.limit_mode !== undefined && cap.limit_mode !== 'amount_credits')) {
    return { usedPercentage: reached ? 100 : 0, resetsAt, used }
  }
  return capped(used, limit, resetsAt, reached)
}

function capped(used: number, limit: number, resetsAt: string, reached: boolean): LimitWindow {
  const share = Math.round((used / limit) * 1000) / 10
  return { usedPercentage: reached ? 100 : Math.min(share, 99), resetsAt, used, limit }
}

/** A credit amount as a number or a decimal string; `undefined` — neither, or below zero. */
function amountOf(value: unknown): number | undefined {
  const amount = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  return Number.isFinite(amount) && amount >= 0 ? amount : undefined
}

/** A reached cap with no count read: the month is spent until it turns. */
export function spentSeatMonth(at: string): LimitWindow {
  return { usedPercentage: 100, resetsAt: nextMonth(at) }
}

function nextMonth(at: string): string {
  const now = new Date(at)
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
