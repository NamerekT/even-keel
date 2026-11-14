import type { DoneMove } from '../chain/moves.js'
import { noticeOf, type Notice } from '../notice/notice.js'
import { closeInto, type PendingCloses } from './close.js'
import { MergeMarks } from './closes.js'

export interface MergeCloserOptions {
  /** The own commits of the task's branches main has (`mergedCommits`); none — not merged. */
  merged: (project: string, task: string) => Promise<string[]>
  /** `false` — the task was already closed. `status` — the done status to close it into; none — the tracker's first. */
  complete: (task: string, status?: string) => Promise<boolean>
  /** The done status the reader's source closes into (BTN-554); none — automatic. */
  done?: (project: string) => DoneMove | undefined
  onError?: (error: unknown) => void
  /** What was closed before, shared by the service's trackers and kept through a restart; none — this closer's own. */
  marks?: MergeMarks
  /** The merged pull requests' tasks whose close was refused (BTN-1163), shared with the chain: retried here and shown with the closer's own. */
  pending?: PendingCloses
}

export class MergeCloser {
  private readonly marks: MergeMarks
  private readonly refused = new Map<string, Map<string, Notice>>()

  constructor(private readonly options: MergeCloserOptions) {
    this.marks = options.marks ?? new MergeMarks()
  }

  failures(project: string): Notice[] {
    return [...(this.refused.get(project)?.values() ?? []), ...(this.options.pending?.failures(project) ?? [])]
  }

  /**
   * `open` — the tasks the tracker's last read shows open: one closed before and open again was reopened. It is closed
   * again only once main has an own commit of its branch it did not have at the last close (BTN-689): the branch merged
   * before the reopen is merged at once, and would close it the moment the chain takes it back. A reopened task the
   * chain does not hold takes what is merged meanwhile into its mark (BTN-694): only a merge made while held closes it.
   */
  async sweep(project: string, tasks: string[], open: string[] = []): Promise<string[]> {
    const refused = this.refused.get(project) ?? new Map<string, Notice>()
    this.refused.set(project, refused)
    const held = new Set(tasks)
    for (const task of refused.keys()) if (!held.has(task)) refused.delete(task)
    const reopened = new Set(open)
    for (const task of reopened) {
      if (held.has(task) || this.marks.of(project, task) === undefined) continue
      try {
        this.marks.absorb(project, task, await this.options.merged(project, task))
      } catch (error) {
        this.options.onError?.(error)
      }
    }
    const pending = this.options.pending
    pending?.keep(project, tasks)
    const closed: string[] = []
    for (const task of tasks) {
      const mark = this.marks.of(project, task)
      // A merged pull request's task whose close was refused is closed again whatever main has of its branch (BTN-1163).
      const pulled = pending?.has(project, task) === true
      if (mark !== undefined && !reopened.has(task) && !pulled) continue
      try {
        const commits = await this.options.merged(project, task)
        if (!pulled && (commits.length === 0 || (mark !== undefined && commits.every((commit) => mark.includes(commit))))) {
          refused.delete(task)
          continue
        }
        let moved: boolean
        try {
          const complete = (status?: string) => (status === undefined ? this.options.complete(task) : this.options.complete(task, status))
          moved = await closeInto(task, this.options.done?.(project), complete, { ...(this.options.onError !== undefined && { onRefused: this.options.onError }) })
        } catch (error) {
          if (pulled) pending!.note(project, task, noticeOf(error))
          else refused.set(task, noticeOf(error))
          continue
        }
        refused.delete(task)
        pending?.clear(project, task)
        if (commits.length > 0) this.marks.mark(project, task, commits)
        if (moved) closed.push(task)
      } catch (error) {
        this.options.onError?.(error)
      }
    }
    return closed
  }
}
