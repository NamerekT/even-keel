import type { Notice } from '../../src/notice/notice.js'
import type { EvenKeelState, SessionView } from '../../src/state.js'
import { isOpen } from '../../src/tracker/model.js'

type CompletionNotice = Extract<Notice, { code: 'tracker.completeRefused' | 'statusMove.notDone' }>
type MoveNotice = Extract<Notice, { code: 'statusMove.refused' | 'statusMove.outside' }>

/** A tracker view's failures of open tasks of this project, its feeds' included; closed tasks hide stale polling results. */
function openFailures(state: EvenKeelState, project: string | undefined, pick: (tracker: EvenKeelState['trackers'][number]) => Record<string, Notice[]> | undefined): Notice[] {
  const readers = project === undefined ? null : new Set([project, ...(state.config.feeds[project] ?? []).map((feed) => feed.id)])
  const open = new Set(state.tasks.filter((task) => isOpen(task.status)).map((task) => task.id))
  return state.trackers.flatMap((tracker) =>
    Object.entries(pick(tracker) ?? {})
      .filter(([reader]) => readers === null || readers.has(reader))
      .flatMap(([, failures]) => failures)
      .filter((failure) => 'task' in failure.params && open.has(failure.params.task as string)),
  )
}

/** Refused closes belonging to this project, including its feeds: the tracker refused, or the rules do not take the status for done. */
export function completionNotices(state: EvenKeelState | null, project?: string): CompletionNotice[] {
  if (state === null) return []
  return openFailures(state, project, (tracker) => tracker.completionFailures).filter(
    (failure): failure is CompletionNotice => failure.code === 'tracker.completeRefused' || failure.code === 'statusMove.notDone',
  )
}

/** Moves on a task's start or pull request that did not go through (BTN-554); the chain went on regardless. */
export function moveNotices(state: EvenKeelState | null, project?: string): MoveNotice[] {
  if (state === null) return []
  return openFailures(state, project, (tracker) => tracker.moveFailures).filter(
    (failure): failure is MoveNotice => failure.code === 'statusMove.refused' || failure.code === 'statusMove.outside',
  )
}

export function completionTasks(state: EvenKeelState | null): ReadonlySet<string> {
  return new Set(completionNotices(state).map((failure) => failure.params.task))
}

/** A real question or permission still needs an answer even if the merged task cannot close. */
export function needsReply(session: SessionView): boolean {
  return session.asking || session.ask !== null || session.waitingFor !== null || session.startupDialog !== null
}
