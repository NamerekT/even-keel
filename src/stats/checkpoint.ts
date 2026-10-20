// The context size of the checkpoint hook's first nudge for one project (BTN-86). A handoff pays off when the
// cache reads it saves over the work left outweigh the note and the successor's recovery, so the threshold is
// the successor's context plus the handoff's cost in cache reads of the work left. Only what does not depend
// on the threshold itself is measured: the work left is a constant, or a higher threshold would shorten the
// measured remainder and pull itself up.

import type { CheckpointShares } from '../state.js'

export const DEFAULT_FIRST = 200_000
const MIN_FIRST = 150_000
const MAX_FIRST = 250_000
/** Requests still ahead of a session at the threshold: about the lower quartile of what was measured. */
const WORK_LEFT = 40
export const MIN_HANDOFFS = 20
export const MIN_SESSIONS = 50

export interface CheckpointMeasure {
  /** Sessions started from a checkpoint note. */
  handoffs: number
  /** Sessions whose context went over 150k. */
  sessions: number
  /** Median context of a successor at its 15th request, tokens. */
  base: number | null
  /** Median spend of a session from writing the note to its end, $. */
  note: number | null
  /** Median spend of a successor before its first edit, $. */
  recovery: number | null
  /** Cache read price of the successors' model, $ per million tokens. */
  cacheRead: number | null
}

export interface CheckpointThreshold {
  project: string
  first: number
  source: 'default' | 'config' | 'calibrated'
  handoffs: number
  sessions: number
}

/**
 * What the hook of one chain session gets: the project's threshold, how many handoffs the task has had, and the
 * session's context, read by the agent's adapter so the hook reads no transcript; `null` — not known yet.
 */
export interface SessionCheckpoint {
  project: string
  task: string
  handoffs: number
  first: number
  /** `window` — the project's threshold was lowered to fit the session's context window. */
  source: CheckpointThreshold['source'] | 'window'
  /** The hook's late and hard thresholds at most, from the session's window (BTN-259); `null` — the hook keeps its own. */
  late: number | null
  hard: number | null
  context: number | null
}

/**
 * The percents of a session's context window the thresholds come at, at most, unless the settings give others
 * (`stats.checkpointShares`, BTN-261): the first nudge — past it the agent's own compaction may come first (BTN-187),
 * the late nudges and the hard threshold of a held task (BTN-259).
 */
export const DEFAULT_SHARES: Readonly<CheckpointShares> = Object.freeze({ first: 72, late: 85, hard: 95 })

const shareOf = (window: number, percent: number) => Math.floor((window * percent) / 100 / 1000) * 1000

/**
 * The thresholds of one session: a default or calibrated one over the share of its window goes down to it, and
 * the late and hard ones are capped by theirs. One pinned in the settings stays as it is, past the window too,
 * with the hook's own later thresholds: whoever pinned it meant it.
 */
export function withinWindow(
  threshold: Pick<SessionCheckpoint, 'first' | 'source'>,
  window: number | null,
  shares: CheckpointShares = DEFAULT_SHARES,
): Pick<SessionCheckpoint, 'first' | 'source' | 'late' | 'hard'> {
  if (window === null || threshold.source === 'config') return { ...threshold, late: null, hard: null }
  const cap = shareOf(window, shares.first)
  const first = threshold.first > cap ? { first: cap, source: 'window' as const } : threshold
  return { ...first, late: shareOf(window, shares.late), hard: shareOf(window, shares.hard) }
}

function calibrated(measure: CheckpointMeasure): number | null {
  const { base, note, recovery, cacheRead } = measure
  if (measure.handoffs < MIN_HANDOFFS || measure.sessions < MIN_SESSIONS) return null
  if (base === null || note === null || recovery === null || cacheRead === null || cacheRead <= 0) return null
  const first = base + (note + recovery) / ((cacheRead / 1_000_000) * WORK_LEFT)
  return Math.min(MAX_FIRST, Math.max(MIN_FIRST, Math.round(first / 1000) * 1000))
}

/** `measure` is null when there are no statistics; `pinned` is the number from the config, which switches calibration off. */
export function checkpointThreshold(project: string, measure: CheckpointMeasure | null, pinned: number | null): CheckpointThreshold {
  const counts = { handoffs: measure?.handoffs ?? 0, sessions: measure?.sessions ?? 0 }
  if (pinned !== null) return { project, first: pinned, source: 'config', ...counts }
  const first = measure === null ? null : calibrated(measure)
  if (first === null) return { project, first: DEFAULT_FIRST, source: 'default', ...counts }
  return { project, first, source: 'calibrated', ...counts }
}
