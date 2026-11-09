import { isOwnName } from '../../../src/chain/fix.js'
import type { SessionView, TaskWork } from '../../../src/state.js'
import { needsReply } from '../completion.js'

/**
 * Whether "Accept as answer" (BTN-885) is offered for the current session of a task: its turn ended on a message —
 * no question, dialog, error, limit or checkpoint — and its folder holds no work main lacks (`work`, BTN-298), which
 * closes by a merge. `completing` — the task is merged and only the tracker refused to close it. The service checks
 * the folder again on the press; this only keeps the button away where it would be refused.
 */
export function offersAccept(session: SessionView, task: string, work: TaskWork | undefined, completing: boolean): boolean {
  if (isOwnName(task) || completing || work !== undefined) return false
  if (session.lamp !== 'waiting' && session.lamp !== 'finished') return false
  if (needsReply(session) || session.checkpoint || session.apiError !== null) return false
  return session.feed.at(-1)?.kind === 'text'
}
