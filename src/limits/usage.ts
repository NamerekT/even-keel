import { notice, type Notice } from '../notice/notice.js'
import type { LimitWindow, RateLimits } from './model.js'
import { resetTimeOf } from './reset.js'

export type UsageAnswer =
  | { kind: 'limits'; limits: RateLimits }
  | { kind: 'spent'; reason: Notice }
  | { kind: 'missing'; reason: Notice }
  | { kind: 'unknown'; reason: Notice }

export interface UsageHealth {
  state: 'waiting' | 'ok' | 'unread' | 'stale' | 'off'
  reason: Notice | null
  since: string | null
}

const SUBSCRIPTION_LINE = /^You are currently using your subscription\b/m
const LIMIT_LINE = /^Current (session|week)\b/m
const SESSION_LINE = /^Current session:\s*(\d+(?:\.\d+)?)% used\b(.*)$/m
const WEEK_LINE = /^Current week \(all models\):\s*(\d+(?:\.\d+)?)% used\b(.*)$/m

export function parseUsage(stdout: string, at: string): UsageAnswer {
  let body: unknown
  try {
    body = JSON.parse(stdout)
  } catch {
    return { kind: 'unknown', reason: notice('usage.notJson', {}) }
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { kind: 'unknown', reason: notice('usage.notObject', {}) }
  const { num_turns: turns, total_cost_usd: cost, is_error: failed, result } = body as Record<string, unknown>
  if (turns !== 0) return { kind: 'spent', reason: notice('usage.turns', { value: JSON.stringify(turns) ?? 'missing' }) }
  if (cost !== 0) return { kind: 'spent', reason: notice('usage.cost', { value: JSON.stringify(cost) ?? 'missing' }) }
  if (failed !== false) return { kind: 'unknown', reason: notice('usage.isError', {}) }
  if (typeof result !== 'string') return { kind: 'unknown', reason: notice('usage.noResult', {}) }

  if (SUBSCRIPTION_LINE.test(result) && !LIMIT_LINE.test(result)) return { kind: 'missing', reason: notice('usage.noLimits', {}) }
  const fiveHour = windowOf(SESSION_LINE.exec(result), at)
  if (fiveHour === undefined) return { kind: 'unknown', reason: notice('usage.noSession', {}) }
  const sevenDay = windowOf(WEEK_LINE.exec(result), at)
  if (sevenDay === undefined) return { kind: 'unknown', reason: notice('usage.noWeek', {}) }
  return { kind: 'limits', limits: { fiveHour, sevenDay, updatedAt: at, source: 'usage' } }
}

function windowOf(match: RegExpExecArray | null, at: string): LimitWindow | null | undefined {
  if (match === null) return undefined
  const usedPercentage = Number(match[1])
  const resetsAt = resetTimeOf(match[2]!, at)
  if (resetsAt !== null) return { usedPercentage, resetsAt }
  return usedPercentage === 0 && match[2]!.trim() === '' ? null : undefined
}
