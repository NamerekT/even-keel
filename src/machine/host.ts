import type { NoteText } from '../chain/handoff-note.js'
import type { DispatcherDeps } from '../chain/model.js'
import type { Notice } from '../notice/notice.js'

/**
 * What a move of a task's session (`Handovers`, `OverageStops`) is given besides the port (`docs/machines.md`,
 * "Moves"). On the machine every member is its own: `save` posts the task's state to the hub, the rest are the
 * values the hub sent with the command. In the hub's process (a port without `moves`) they are the hub's.
 */
export interface MoveDeps extends Pick<DispatcherDeps, 'machine' | 'journal' | 'now' | 'log' | 'promptLanguage' | 'mainBranch' | 'pullRequests' | 'plain'> {
  /** Keeps the state of the move's task: before the session is touched, so a restart can see the move through. */
  save: () => void
  /** Why the task's session may not start now; the same as the hub's launch decision. */
  blocked: (project: string, task: string) => Notice | undefined
  /** The report of the red main or the carry a fix or carry session works on, for its handoff. */
  report: (task: string) => string | undefined
  /** The task's newest handoff note the hub keeps (BTN-1046); absent or `undefined` — none. */
  note?: (task: string) => NoteText | undefined
}
