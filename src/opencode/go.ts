import type { KeyVerdict } from '../account/keycheck.js'
import type { LimitWindow, RateLimits } from '../limits/model.js'
import type { UsageAnswer } from '../limits/usage.js'
import { notice } from '../notice/notice.js'

export const GO_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage'

/** The three Go windows; percentages stay on the provider's 0–100 scale, including values below one. */
export function goLimits(body: unknown, at: string): RateLimits | undefined {
  const usage = record(record(body)?.usage)
  const fiveHour = windowOf(usage?.rolling)
  const sevenDay = windowOf(usage?.weekly)
  const month = windowOf(usage?.monthly)
  return fiveHour === undefined || sevenDay === undefined || month === undefined
    ? undefined : { fiveHour, sevenDay, month, updatedAt: at, source: 'api' }
}

export async function goUsage(key: string, at: string, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<UsageAnswer> {
  const response = await ask(key, timeoutMs, fetchImpl)
  if (response.status === 403) return { kind: 'missing', reason: notice('usage.openCodeNone', {}) }
  if (response.status === 401) return { kind: 'missing', reason: notice('usage.goKeyExpired', {}) }
  if (!response.ok) throw new Error(`OpenCode Go usage answer was ${response.status}`)
  const limits = goLimits(await response.json().catch(() => undefined), at)
  return limits === undefined ? { kind: 'unknown', reason: notice('usage.goUnread', {}) } : { kind: 'limits', limits }
}

/** A 403 is a valid Console key without Go; the public models list does not validate keys. */
export async function checkGoKey(key: string, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<KeyVerdict> {
  try {
    const response = await ask(key, timeoutMs, fetchImpl)
    if (response.status === 401) return { state: 'rejected' }
    if (response.ok || response.status === 403) return { state: 'ok' }
    return { state: 'unknown', reason: `HTTP ${response.status}` }
  } catch {
    return { state: 'unknown', reason: 'OpenCode Console did not answer' }
  }
}

function ask(key: string, timeoutMs: number, fetchImpl: typeof fetch): Promise<Response> {
  return fetchImpl(GO_USAGE_URL, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) })
}

function windowOf(raw: unknown): LimitWindow | undefined {
  const window = record(raw)
  if (typeof window?.percent !== 'number' || !Number.isFinite(window.percent) || window.percent < 0) return undefined
  if (typeof window.resetsAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(window.resetsAt)) return undefined
  const reset = Date.parse(window.resetsAt)
  return Number.isFinite(reset) ? { usedPercentage: window.percent, resetsAt: new Date(reset).toISOString() } : undefined
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
