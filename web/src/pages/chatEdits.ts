import { isOwnName } from '../../../src/chain/fix.js'
import type { BranchDiff } from '../../../src/state.js'
import type { EditTotal } from './toolGroups.js'

/** The counter of the chat's foot: the lines of the task's branch, or the session's own edits. */
export interface ChatEdits extends EditTotal {
  of: 'branch' | 'session'
}

/**
 * What the chat's foot counts (BTN-1424). A tracker task's chat counts its branch against the main branch, as the
 * service last read its folder: every session of the task shows the same, and a handoff does not empty it; a branch with
 * no change shows nothing. A project chat, a fix of main, and a task whose folder the service does not read (gone, no
 * git) count the edits of the session's own transcript.
 */
export function chatEdits(
  diffs: Record<string, Record<string, BranchDiff>> | undefined,
  task: { key: string; project?: string } | undefined,
  session: EditTotal | null,
): ChatEdits | null {
  const branch = task?.project === undefined || isOwnName(task.key) ? undefined : diffs?.[task.project]?.[task.key]
  if (branch !== undefined) return branch.added === 0 && branch.removed === 0 ? null : { ...branch, of: 'branch' }
  return session === null ? null : { ...session, of: 'session' }
}
