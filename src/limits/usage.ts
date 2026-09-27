import type { LimitWindow, RateLimits } from './model.js'
import { resetTimeOf } from './reset.js'

export type UsageAnswer = { kind: 'limits'; limits: RateLimits } | { kind: 'spent'; reason: string } | { kind: 'unknown'; reason: string }

export interface UsageHealth {
  state: 'waiting' | 'ok' | 'unread' | 'off'
  reason: string | null
  since: string | null
}

const SESSION_LINE = /^Current session:\s*(\d+(?:\.\d+)?)% used\b(.*)$/m
const WEEK_LINE = /^Current week \(all models\):\s*(\d+(?:\.\d+)?)% used\b(.*)$/m

export function parseUsage(stdout: string, at: string): UsageAnswer {
  let body: unknown
  try {
    body = JSON.parse(stdout)
  } catch {
    return { kind: 'unknown', reason: 'the answer is not JSON' }
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { kind: 'unknown', reason: 'the answer is not a JSON object' }
  const { num_turns: turns, total_cost_usd: cost, is_error: failed, result } = body as Record<string, unknown>
  if (turns !== 0) return { kind: 'spent', reason: `num_turns is ${JSON.stringify(turns) ?? 'missing'}, not 0` }
  if (cost !== 0) return { kind: 'spent', reason: `total_cost_usd is ${JSON.stringify(cost) ?? 'missing'}, not 0` }
  if (failed !== false) return { kind: 'unknown', reason: 'the answer is an error' }
  if (typeof result !== 'string') return { kind: 'unknown', reason: 'the answer has no result text' }

  const fiveHour = windowOf(SESSION_LINE.exec(result), at)
  if (fiveHour === undefined) return { kind: 'unknown', reason: 'no readable "Current session" line' }
  const sevenDay = windowOf(WEEK_LINE.exec(result), at)
  if (sevenDay === undefined) return { kind: 'unknown', reason: 'no readable "Current week (all models)" line' }
  return { kind: 'limits', limits: { fiveHour, sevenDay, updatedAt: at, source: 'usage' } }
}

function windowOf(match: RegExpExecArray | null, at: string): LimitWindow | null | undefined {
  if (match === null) return undefined
  const usedPercentage = Number(match[1])
  const resetsAt = resetTimeOf(match[2]!, at)
  if (resetsAt !== null) return { usedPercentage, resetsAt }
  return usedPercentage === 0 && match[2]!.trim() === '' ? null : undefined
}
