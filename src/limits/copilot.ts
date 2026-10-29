import { notice } from '../notice/notice.js'
import type { LimitWindow, RateLimits } from './model.js'
import type { UsageAnswer } from './usage.js'
import { copilotOverage, githubOverage } from './overage.js'

/** GitHub's own answer about a Copilot sign-in, the one its editors show the allowance by; internal, not documented. */
export const COPILOT_USER_URL = 'https://api.github.com/copilot_internal/user'
const GITHUB_API = 'https://api.github.com'
/** The quota the CLI spends, first; completions are the editors' and never stop a session. */
const PREFERRED_QUOTA = 'premium_interactions'
const SKIPPED_QUOTA = 'completions'

/**
 * The monthly allowance of a Copilot answer (BTN-341): the first limited `quota_snapshots` entry — premium requests, else
 * another one such as AI credits — or the free plan's `limited_user_quotas.chat` out of `monthly_quotas.chat`, as one
 * month window that counts what is left. `unlimited` — every quota is; `undefined` — nothing readable.
 */
export function copilotLimits(body: unknown, at: string): RateLimits | 'unlimited' | undefined {
  if (!isRecord(body)) return undefined
  const resetsAt = resetOf(body.quota_reset_date_utc ?? body.quota_reset_date ?? body.limited_user_reset_date, at)
  const snapshots = isRecord(body.quota_snapshots) ? body.quota_snapshots : undefined
  if (snapshots !== undefined) {
    const quotas = Object.entries(snapshots).filter((entry): entry is [string, Record<string, unknown>] => entry[0] !== SKIPPED_QUOTA && isRecord(entry[1]))
    const limited = quotas.filter(([, quota]) => quota.unlimited !== true).sort(([a], [b]) => Number(b === PREFERRED_QUOTA) - Number(a === PREFERRED_QUOTA))
    for (const [, quota] of limited) {
      const window = counted(quota.entitlement, quota.remaining, resetsAt)
      if (window !== undefined) {
        const overage = copilotOverage(quota, at)
        return { ...monthOnly(window, at), ...(overage !== undefined && { overage }) }
      }
    }
    if (quotas.length > 0 && limited.length === 0) return 'unlimited'
  }
  const left = isRecord(body.limited_user_quotas) ? body.limited_user_quotas.chat : undefined
  const total = isRecord(body.monthly_quotas) ? body.monthly_quotas.chat : undefined
  const window = counted(total, left, resetsAt)
  return window === undefined ? undefined : monthOnly(window, at)
}

/**
 * The Copilot requests of the month by GitHub's billing (`premium_request/usage`): what was spent, the allowance not known,
 * so the window is never shown as full — it only tells when the month resets. `undefined` — no usage items.
 */
export function billingLimits(body: unknown, at: string): RateLimits | undefined {
  if (!isRecord(body) || !Array.isArray(body.usageItems)) return undefined
  const used = body.usageItems
    .filter((item): item is Record<string, unknown> => isRecord(item) && typeof item.product === 'string' && item.product.toLowerCase() === 'copilot')
    .reduce((sum, item) => sum + (typeof item.grossQuantity === 'number' ? item.grossQuantity : 0), 0)
  const overage = githubOverage(body.usageItems, at)
  return { ...monthOnly({ usedPercentage: 0, resetsAt: nextMonth(at), used: Math.round(used * 100) / 100 }, at), ...(overage !== undefined && { overage }) }
}

/** Asks GitHub for the allowance of a Copilot sign-in's OAuth token (OpenCode's `github-copilot`). */
export async function askCopilot(token: string, at: string, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<UsageAnswer> {
  const response = await get(COPILOT_USER_URL, `token ${token}`, timeoutMs, fetchImpl)
  if (response.status === 401) return { kind: 'missing', reason: notice('usage.copilotSignIn', {}) }
  if (!response.ok) throw new Error(`GitHub's Copilot answer was ${response.status}`)
  return quotaAnswer(await response.json().catch(() => undefined), at)
}

/**
 * Asks GitHub about a Copilot account's own token (a fine-grained one, `COPILOT_GITHUB_TOKEN`): the allowance if GitHub
 * gives it to such a token, else the month's requests by the billing API, which needs the token's "Plan" permission.
 */
export async function askCopilotToken(token: string, at: string, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<UsageAnswer> {
  const auth = `Bearer ${token}`
  const quota = await get(COPILOT_USER_URL, auth, timeoutMs, fetchImpl)
  if (quota.ok) {
    const answer = quotaAnswer(await quota.json().catch(() => undefined), at)
    if (answer.kind !== 'unknown') return answer
  }
  const user = await get(`${GITHUB_API}/user`, auth, timeoutMs, fetchImpl)
  if (user.status === 401) return { kind: 'missing', reason: notice('usage.copilotSignIn', {}) }
  if (!user.ok) throw new Error(`GitHub's user answer was ${user.status}`)
  const login: unknown = ((await user.json().catch(() => ({}))) as Record<string, unknown>).login
  if (typeof login !== 'string' || login === '') return { kind: 'unknown', reason: notice('usage.copilotUnread', {}) }
  const usage = await get(`${GITHUB_API}/users/${encodeURIComponent(login)}/settings/billing/premium_request/usage`, auth, timeoutMs, fetchImpl)
  if (usage.status === 403 || usage.status === 404) return { kind: 'missing', reason: notice('usage.planRead', {}) }
  if (!usage.ok) throw new Error(`GitHub's billing answer was ${usage.status}`)
  const limits = billingLimits(await usage.json().catch(() => undefined), at)
  return limits === undefined ? { kind: 'unknown', reason: notice('usage.copilotUnread', {}) } : { kind: 'limits', limits }
}

function quotaAnswer(body: unknown, at: string): UsageAnswer {
  const limits = copilotLimits(body, at)
  if (limits === 'unlimited') return { kind: 'missing', reason: notice('usage.copilotUnlimited', {}) }
  return limits === undefined ? { kind: 'unknown', reason: notice('usage.copilotUnread', {}) } : { kind: 'limits', limits }
}

function get(url: string, authorization: string, timeoutMs: number, fetchImpl: typeof fetch): Promise<Response> {
  const headers = { Authorization: authorization, Accept: 'application/json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'even-keel' }
  return fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
}

function counted(total: unknown, left: unknown, resetsAt: string): LimitWindow | undefined {
  if (typeof total !== 'number' || typeof left !== 'number' || !(total > 0)) return undefined
  const remaining = Math.max(0, Math.min(left, total))
  return { usedPercentage: Math.round(((total - remaining) / total) * 1000) / 10, resetsAt, left: remaining }
}

function monthOnly(month: LimitWindow, at: string): RateLimits {
  return { fiveHour: null, sevenDay: null, month, updatedAt: at, source: 'api' }
}

/** A reset date of the answer, a day (`2026-11-01`, UTC midnight) or a time; else the 1st of the next month. */
function resetOf(raw: unknown, at: string): string {
  const time = typeof raw === 'string' ? Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw) : NaN
  return Number.isNaN(time) ? nextMonth(at) : new Date(time).toISOString()
}

function nextMonth(at: string): string {
  const now = new Date(at)
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
