import type { LimitWindow, RateLimits } from './model.js'
import { resetTimeOf } from './reset.js'

export type UsageAnswer = { kind: 'limits'; limits: RateLimits } | { kind: 'spent' } | { kind: 'unknown' }

const SESSION_LINE = /^Current session:\s*(\d+(?:\.\d+)?)%\s+used\b(.*)$/m
const WEEK_LINE = /^Current week \(all models\):\s*(\d+(?:\.\d+)?)%\s+used\b(.*)$/m

export function parseUsage(stdout: string, at: string): UsageAnswer {
  let body: unknown
  try {
    body = JSON.parse(stdout)
  } catch {
    return { kind: 'unknown' }
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { kind: 'unknown' }
  const { num_turns: turns, total_cost_usd: cost, is_error: failed, result } = body as Record<string, unknown>
  if ((typeof turns === 'number' && turns > 0) || (typeof cost === 'number' && cost > 0)) return { kind: 'spent' }
  if (failed === true || typeof result !== 'string') return { kind: 'unknown' }

  const fiveHour = windowOf(SESSION_LINE.exec(result), at)
  const sevenDay = windowOf(WEEK_LINE.exec(result), at)
  if (fiveHour === undefined && sevenDay === undefined) return { kind: 'unknown' }
  return { kind: 'limits', limits: { fiveHour: fiveHour ?? null, sevenDay: sevenDay ?? null, updatedAt: at } }
}

function windowOf(match: RegExpExecArray | null, at: string): LimitWindow | null | undefined {
  if (match === null) return undefined
  const resetsAt = resetTimeOf(match[2]!, at)
  return resetsAt === null ? null : { usedPercentage: Number(match[1]), resetsAt }
}
