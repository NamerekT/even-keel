import type { RateLimits } from './model.js'

/** `claude -p /usage` names a reset to the hour or minute; a session's event to the second. */
const RESET_TOLERANCE_MS = 60 * 60_000
/** Usage within one window never falls; a smaller fall is rounding or a poll's text. */
const PERCENT_TOLERANCE = 5

/**
 * The window in which a long token's session windows and the full sign-in's poll of the same account cannot be one
 * window (BTN-1267): its reset stands more than an hour off, or the later reading spent less than the earlier one.
 * `undefined` — they agree, or no window is in both readings within one period.
 */
export function tokenWindowsDiffer(token: RateLimits, poll: RateLimits): 'fiveHour' | 'sevenDay' | undefined {
  const tokenAt = Date.parse(token.updatedAt)
  const pollAt = Date.parse(poll.updatedAt)
  for (const span of ['fiveHour', 'sevenDay'] as const) {
    const ours = token[span]
    const theirs = poll[span]
    if (ours === null || theirs === null) continue
    const oursEnd = Date.parse(ours.resetsAt)
    const theirsEnd = Date.parse(theirs.resetsAt)
    // A window that ended before the other side read it was another period.
    if (oursEnd <= pollAt || theirsEnd <= tokenAt) continue
    if (Math.abs(oursEnd - theirsEnd) > RESET_TOLERANCE_MS) return span
    const [earlier, later] = tokenAt <= pollAt ? [ours, theirs] : [theirs, ours]
    if (later.usedPercentage < earlier.usedPercentage - PERCENT_TOLERANCE) return span
  }
  return undefined
}
