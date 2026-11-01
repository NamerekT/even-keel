import type { DoneMove } from '../chain/moves.js'
import { notice, type Notice } from '../notice/notice.js'
import { MergeMarks } from './closes.js'
import { errorText } from './link.js'

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
}

export class MergeCloser {
  private readonly marks: MergeMarks
  private readonly refused = new Map<string, Map<string, Notice>>()

  constructor(private readonly options: MergeCloserOptions) {
    this.marks = options.marks ?? new MergeMarks()
  }

  failures(project: string): Notice[] {
    return [...(this.refused.get(project)?.values() ?? [])]
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
    const closed: string[] = []
    for (const task of tasks) {
      const mark = this.marks.of(project, task)
      if (mark !== undefined && !reopened.has(task)) continue
      try {
        const commits = await this.options.merged(project, task)
        if (commits.length === 0 || (mark !== undefined && commits.every((commit) => mark.includes(commit)))) {
          refused.delete(task)
          continue
        }
        const done = this.options.done?.(project)
        if (done !== undefined && !done.fits) {
          refused.set(task, notice('statusMove.notDone', { task, status: done.status, level: done.level }))
          continue
        }
        let moved: boolean
        try {
          moved = await (done === undefined ? this.options.complete(task) : this.options.complete(task, done.status))
        } catch (error) {
          const named = done === undefined ? {} : { status: done.status, level: done.level }
          refused.set(task, notice('tracker.completeRefused', { task, ...named }, { detail: errorText(error) }))
          this.options.onError?.(error)
          continue
        }
        refused.delete(task)
        this.marks.mark(project, task, commits)
        if (moved) closed.push(task)
      } catch (error) {
        this.options.onError?.(error)
      }
    }
    return closed
  }
}
