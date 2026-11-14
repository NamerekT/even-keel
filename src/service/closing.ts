import type { ReviewDeps, UnchangedDeps } from '../chain/model.js'
import { doneMove, type DoneMove } from '../chain/moves.js'
import { englishOf, noticeOf } from '../notice/notice.js'
import { checkDone, closeInto } from '../tracker/close.js'
import type { TrackerLink } from '../tracker/link.js'
import type { ServiceContext } from '../service.js'

export type ClosingContext = Pick<ServiceContext, 'linkFor' | 'pendingCloses' | 'readerFor' | 'readerMoves'>

export interface Closing {
  review: ReviewDeps['complete']
  unchanged: UnchangedDeps['complete']
  accept: UnchangedDeps['accept']
}

/**
 * The chain's own closes — a merged pull request, a pull request with nothing to open, a `NO CHANGES:` mark, "Accept
 * as answer" — into the done status the task's source chose, as the merge closer's (BTN-1163).
 */
export function wireClosing(ctx: ClosingContext): Closing {
  const doneOf = (project: string, task: string): DoneMove | undefined => {
    const plan = ctx.readerMoves(ctx.readerFor(project, task))
    return plan === undefined ? undefined : doneMove(plan.rules, plan.profile, plan.source)
  }
  const close = async (link: TrackerLink, task: string, done: DoneMove | undefined, held: boolean): Promise<void> => {
    const complete = (status?: string) => link.run(async (tracker) => (await tracker.complete?.(task, status)) ?? false)
    await closeInto(task, done, complete, held ? { held: true } : {})
  }
  return {
    review: async (project, task, merged) => {
      const link = ctx.linkFor(project, task)
      if (link === undefined) return
      try {
        // A merged one is not held: the merge closer tries it again on each read of the tracker.
        await close(link, task, doneOf(project, task), !merged)
      } catch (error) {
        if (merged) ctx.pendingCloses.note(ctx.readerFor(project, task), task, noticeOf(error))
        throw error
      }
    },
    unchanged: async (project, task, comment) => {
      const link = ctx.linkFor(project, task)
      if (link === undefined) return
      await close(link, task, doneOf(project, task), true)
      // The task is done whatever becomes of the comment.
      await link.run(async (tracker) => tracker.comment?.(task, comment)).catch((error: unknown) => {
        console.warn(`chain: ${task}: the comment on the task closed with no change did not reach the tracker: ${englishOf(noticeOf(error))}`)
      })
    },
    accept: async (project, task, comment) => {
      const link = ctx.linkFor(project, task)
      if (link === undefined) throw new Error(`no tracker is linked to ${task}`)
      const done = doneOf(project, task)
      // Before the comment: a close that cannot go through leaves no answer on a task still open.
      checkDone(task, done, { held: true })
      await link.run(async (tracker) => {
        if (tracker.comment === undefined || tracker.complete === undefined) throw new Error('the tracker cannot comment or close a task')
        await tracker.comment(task, comment)
      })
      await close(link, task, done, true)
    },
  }
}
