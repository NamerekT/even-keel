import type { AgentEntry, Lamp } from './agents.js'

export const TURN_HANG_MS = 30 * 60_000
export const TURN_RESTART_MS = 5 * 60_000
/** How quiet a working turn must be before the panel says so; the first minute is ordinary thinking. */
export const TURN_SILENT_MS = 2 * 60_000

export interface SilentRestart {
  sessionId: string
  since: string
}

export function restartConfirmation(value: unknown): SilentRestart | undefined {
  if (typeof value !== 'object' || value === null || !('sessionId' in value) || !('since' in value)) return undefined
  return typeof value.sessionId === 'string' && typeof value.since === 'string' ? { sessionId: value.sessionId, since: value.since } : undefined
}

/** The silence worth a note: a working turn alone for two minutes with no question pending; a background command after a turn carries no silent stamp. */
export function shownSilence(lamp: Lamp, waitingFor: string | null, silentSince: string | null | undefined, now: number): string | null {
  if (lamp !== 'working' || waitingFor !== null || silentSince == null) return null
  return now - Date.parse(silentSince) >= TURN_SILENT_MS ? silentSince : null
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
