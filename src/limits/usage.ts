import { notice, type Notice } from '../notice/notice.js'
import type { LimitWindow, ModelWeek, RateLimits } from './model.js'
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
const SESSION_START = /^Current session\b/m
const WEEK_START = /^Current week \(all models\)/m
const SESSION_LINE = /^Current session:\s*(\d+(?:\.\d+)?)% used\b(.*)$/m
const WEEK_LINE =/^Current week \(all models\):\s*(\d+(?:\.\d+)?)% used\b(.*)$/m

/**
 * The answer of `claude -p /usage --output-format stream-json --verbose`: a message a line, the last one the `result`
 * with the text. One JSON value — `--output-format json`, or the messages as one array — is read too.
 */
export function parseUsage(stdout: string, at: string): UsageAnswer {
  const messages = messagesOf(stdout)
  if (messages === undefined) return { kind: 'unknown', reason: notice('usage.notJson', {}) }
  const body = messages.findLast((message) => isRecord(message) && message.type === 'result') ?? (messages.length === 1 ? messages[0] : undefined)
  if (!isRecord(body)) return { kind: 'unknown', reason: notice('usage.notObject', {}) }
  const answer = parseResult(body, at)
  if (answer.kind !== 'limits') return answer
  const weeks = modelWeeksOf(usageRows(messages))
  return weeks === undefined ? answer : { kind: 'limits', limits: { ...answer.limits, models: { weeks, updatedAt: at } } }
}

/**
 * The models' own weeks among the rows of a usage answer: `usage_report.rate_limits.limits[]` of the CLI's `/usage`
 * message, the same rows as `limits[]` of `/api/oauth/usage` (`test/fixtures/limits/`). A row is classified by its
 * `kind`, never its label. `undefined` — no rows, so nothing is known; `[]` — the plan has no model week.
 */
export function modelWeeksOf(rows: unknown): ModelWeek[] | undefined {
  if (!Array.isArray(rows)) return undefined
  return rows.flatMap((row): ModelWeek[] => {
    if (!isRecord(row) || row.kind !== 'weekly_scoped' || typeof row.percent !== 'number' || !Number.isFinite(row.percent)) return []
    const model = isRecord(row.scope) && isRecord(row.scope.model) ? row.scope.model.display_name : undefined
    if (typeof model !== 'string' || model.trim() === '') return []
    const reset = typeof row.resets_at === 'string' ? Date.parse(row.resets_at) : Number.NaN
    return [{ model: model.trim(), usedPercentage: row.percent, resetsAt: Number.isNaN(reset) ? null : new Date(reset).toISOString() }]
  })
}

/** Every line a JSON value, or the whole output one; `undefined` — neither. */
function messagesOf(stdout: string): unknown[] | undefined {
  try {
    const whole: unknown = JSON.parse(stdout)
    return Array.isArray(whole) && whole.length > 0 ? whole : [whole]
  } catch {
    const lines = stdout.split(/\r?\n/).filter((line) => line.trim() !== '')
    try {
      return lines.length > 1 ? lines.map((line) => JSON.parse(line) as unknown) : undefined
    } catch {
      return undefined
    }
  }
}

/** The rows of the newest message with a `usage_report` whose CLI could fetch them. */
function usageRows(messages: unknown[]): unknown {
  for (const message of messages.toReversed()) {
    if (!isRecord(message) || !isRecord(message.usage_report)) continue
    const { rate_limits: limits } = message.usage_report
    return isRecord(limits) ? limits.limits : undefined
  }
  return undefined
}

function parseResult(body: Record<string, unknown>, at: string): UsageAnswer {
  const { num_turns: turns, total_cost_usd: cost, is_error: failed, result } = body
  if (turns !== 0) return { kind: 'spent', reason: notice('usage.turns', { value: JSON.stringify(turns) ?? 'missing' }) }
  if (cost !== 0) return { kind: 'spent', reason: notice('usage.cost', { value: JSON.stringify(cost) ?? 'missing' }) }
  if (failed !== false) return { kind: 'unknown', reason: notice('usage.isError', {}) }
  if (typeof result !== 'string') return { kind: 'unknown', reason: notice('usage.noResult', {}) }

  if (SUBSCRIPTION_LINE.test(result) && !LIMIT_LINE.test(result)) return { kind: 'missing', reason: notice('usage.noLimits', {}) }
  const hasSession = SESSION_START.test(result)
  const hasWeek = WEEK_START.test(result)
  // A plan may lack a window (BTN-729): a verified Ultra has no session line, a Team seat no all-models week. A line
  // that is there but does not parse is a new format, not an absent window.
  if (!hasSession && !hasWeek) return { kind: 'unknown', reason: notice('usage.noSession', {}) }
  const fiveHour = hasSession ? windowOf(SESSION_LINE.exec(result), at) : null
  if (fiveHour === undefined) return { kind: 'unknown', reason: notice('usage.noSession', {}) }
  const sevenDay = hasWeek ? windowOf(WEEK_LINE.exec(result), at) : null
  if (sevenDay === undefined) return { kind: 'unknown', reason: notice('usage.noWeek', {}) }
  const absent = [...(hasSession ? [] : ['fiveHour' as const]), ...(hasWeek ? [] : ['sevenDay' as const])]
  return { kind: 'limits', limits: { fiveHour, sevenDay, ...(absent.length > 0 && { absent }), updatedAt: at, source: 'usage' } }
}

function windowOf(match: RegExpExecArray | null, at: string): LimitWindow | null | undefined {
  if (match === null) return undefined
  const usedPercentage = Number(match[1])
  const resetsAt = resetTimeOf(match[2]!, at)
  if (resetsAt !== null) return { usedPercentage, resetsAt }
  return usedPercentage === 0 && match[2]!.trim() === '' ? null : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
