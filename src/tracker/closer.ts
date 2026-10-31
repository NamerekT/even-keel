import type { DoneMove } from '../chain/moves.js'
import { notice, type Notice } from '../notice/notice.js'
import { errorText } from './link.js'

export interface MergeCloserOptions {
  merged: (project: string, task: string) => Promise<boolean>
  /** `false` — the task was already closed. `status` — the done status to close it into; none — the tracker's first. */
  complete: (task: string, status?: string) => Promise<boolean>
  /** The done status the reader's source closes into (BTN-554); none — automatic. */
  done?: (project: string) => DoneMove | undefined
  onError?: (error: unknown) => void
}

export class MergeCloser {
  private readonly closed = new Set<string>()
  private readonly refused = new Map<string, Map<string, Notice>>()

  constructor(private readonly options: MergeCloserOptions) {}

  failures(project: string): Notice[] {
    return [...(this.refused.get(project)?.values() ?? [])]
  }

  /** `open` — the tasks the tracker's last read shows open: one closed before and open again was reopened, and is closed again once merged. */
  async sweep(project: string, tasks: string[], open: string[] = []): Promise<string[]> {
    const refused = this.refused.get(project) ?? new Map<string, Notice>()
    this.refused.set(project, refused)
    const held = new Set(tasks)
    for (const task of refused.keys()) if (!held.has(task)) refused.delete(task)
    for (const task of open) this.closed.delete(task)
    const closed: string[] = []
    for (const task of tasks) {
      if (this.closed.has(task)) continue
      try {
        if (!(await this.options.merged(project, task))) {
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
        this.closed.add(task)
        if (moved) closed.push(task)
      } catch (error) {
        this.options.onError?.(error)
      }
    }
    return closed
  }
}
