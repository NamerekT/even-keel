import type { AgentEntry } from './agents.js'

export const TURN_HANG_MS = 30 * 60_000
export const TURN_RESTART_MS = 5 * 60_000

export interface SilentRestart {
  sessionId: string
  since: string
}

export function restartConfirmation(value: unknown): SilentRestart | undefined {
  if (typeof value !== 'object' || value === null || !('sessionId' in value) || !('since' in value)) return undefined
  return typeof value.sessionId === 'string' && typeof value.since === 'string' ? { sessionId: value.sessionId, since: value.since } : undefined
}

/** No automatic stop: only expose the quiet turn for the user's reply or replacement. */
export function hungEntry(entry: AgentEntry, lastChange: number, now: number): AgentEntry {
  if (entry.status !== 'busy' || entry.pid === undefined) return entry
  const quiet = { ...entry, silentSince: lastChange }
  return now - lastChange < TURN_HANG_MS ? quiet : { ...quiet, status: 'idle', hungSince: lastChange }
}

export function silentRestart(sessionId: string, since: string | null | undefined, confirmed: SilentRestart | undefined, now: number): boolean {
  return since != null && confirmed?.sessionId === sessionId && confirmed.since === since && now - Date.parse(since) >= TURN_RESTART_MS
}
