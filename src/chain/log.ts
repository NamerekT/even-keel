import type { LaunchEntry } from './dispatcher.js'

/** The service log line for an entry of the launch journal. */
export function launchLine(entry: LaunchEntry): string {
  const { task, sessionId, reason, previous, blockers } = entry
  if (reason === undefined) return `chain: ${task} started in the session ${sessionId}`
  if (reason === 'skip' || reason === 'postpone') {
    const why = blockers !== undefined && blockers.length > 0 ? `${reason}, blocked by ${blockers.join(', ')}` : reason
    return `chain: ${task} released (${why}), its session ${sessionId} is left as it is`
  }
  return `chain: ${task} handed over by ${reason} from the session ${previous ?? 'unknown'} to ${sessionId}`
}
