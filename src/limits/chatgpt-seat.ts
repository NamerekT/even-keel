import type { LimitWindow } from './model.js'

/** Plans a person buys for themselves: a workspace seat (Team, Business, Edu, Enterprise) is any other. */
const PERSONAL_PLANS = new Set(['free', 'go', 'plus', 'pro'])

/**
 * Where ChatGPT's spend page reads a workspace seat's monthly credits (EKR-132): the owner's cap and what the seat used
 * this month. `wham/usage` has neither; Codex does not ask it.
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
 * The seat's month out of the `monthly-usage` answer: the credits used of the cap, resetting at the next calendar month
 * in UTC (no reset is named; none other seen yet). Whether the seat is closed is `spend_control.reached`'s to say, so
 * the count alone stays under 100 %, and `reached` makes it 100 %. `undefined` — not an answer in credits.
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
  const share = Math.round((used / limit) * 1000) / 10
  return { usedPercentage: reached ? 100 : Math.min(share, 99), resetsAt, used, limit }
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
