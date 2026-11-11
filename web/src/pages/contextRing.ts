import type { ContextScale } from '../../../src/state.js'
import type { SessionCheckpoint } from '../../../src/stats/checkpoint.js'
import type { ContextLevel } from '../state.js'

/** What the chat's context ring and its popover show. */
export interface RingFacts {
  tokens: number
  /** The session's window, or the setting's while it gave none; `null` — unknown. */
  window: number | null
  /** How full the window is; `null` while the window is unknown. */
  percent: number | null
  level: ContextLevel
  /** Where the checkpoint threshold stands on the bar, in percent; `null` — none, or past the window. */
  mark: number | null
}

export function ringFacts(tokens: number, own: number | null, scale: ContextScale | null, checkpoint: number | null): RingFacts {
  const window = own ?? scale?.window ?? null
  if (window === null || window <= 0) return { tokens, window: null, percent: null, level: 'ok', mark: null }
  const percent = Math.min(100, (tokens / window) * 100)
  const level = scale === null ? 'ok' : percent >= scale.danger ? 'danger' : percent >= scale.warn ? 'warn' : 'ok'
  const mark = checkpoint !== null && checkpoint < window ? (checkpoint / window) * 100 : null
  return { tokens, window, percent, level, mark }
}

/** The context size the agent-bridge hook first asks the session for a handoff at; `null` — it asks at none. */
export function checkpointMark(found: SessionCheckpoint | null): number | null {
  return found === null || found.source === 'off' ? null : found.first
}
