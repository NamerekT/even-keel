import type { Notice } from '../../src/notice/notice.js'
import type { EvenKeelState, SessionView } from '../../src/state.js'
import { isOpen } from '../../src/tracker/model.js'

type CompletionNotice = Extract<Notice, { code: 'tracker.completeRefused' }>

/** Refused closes belonging to this project, including its feeds. Closed tasks hide stale polling results. */
export function completionNotices(state: EvenKeelState | null, project?: string): CompletionNotice[] {
  if (state === null) return []
  const readers = project === undefined ? null : new Set([project, ...(state.config.feeds[project] ?? []).map((feed) => feed.id)])
  const open = new Set(state.tasks.filter((task) => isOpen(task.status)).map((task) => task.id))
  return state.trackers.flatMap((tracker) => Object.entries(tracker.completionFailures ?? {})
    .filter(([reader]) => readers === null || readers.has(reader))
    .flatMap(([, failures]) => failures)
    .filter((failure): failure is CompletionNotice => failure.code === 'tracker.completeRefused' && open.has(failure.params.task)))
}

export function completionTasks(state: EvenKeelState | null): ReadonlySet<string> {
  return new Set(completionNotices(state).map((failure) => failure.params.task))
}

/** A real question or permission still needs an answer even if the merged task cannot close. */
export function needsReply(session: SessionView): boolean {
  return session.asking || session.ask !== null || session.waitingFor !== null || session.startupDialog !== null
}
