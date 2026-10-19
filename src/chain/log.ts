import { shortCommit } from '../ci/verdict.js'
import type { LaunchEntry } from './dispatcher.js'

/** The service log line for an entry of the launch journal. */
export function launchLine(entry: LaunchEntry): string {
  const { task, sessionId, reason, previous, blockers } = entry
  if (reason === undefined) return `chain: ${task} started in the session ${sessionId}`
  if (reason === 'skip' || reason === 'postpone') {
    const why = blockers !== undefined && blockers.length > 0 ? `${reason}, blocked by ${blockers.join(', ')}` : reason
    return `chain: ${task} released (${why}), its session ${sessionId} is left as it is`
  }
  if (reason === 'landed') return `chain: ${task} landed, main is at ${entry.commit === undefined ? 'unknown' : shortCommit(entry.commit)}`
  if (reason === 'dropped') return `chain: ${task} dropped, main stays as it was`
  if (reason === 'answer') return `chain: ${task} resumed with the user's answer in the session ${sessionId}`
  // An entry of a pull request opened, or of a launch with its feedback, has no session before it.
  if (previous === undefined) return `chain: ${task} goes on by ${reason} in the session ${sessionId}`
  return `chain: ${task} handed over by ${reason} from the session ${previous} to ${sessionId}`
}
