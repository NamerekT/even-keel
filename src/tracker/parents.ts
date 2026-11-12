import { isOpen, type ParentTask, type Task } from './model.js'

/**
 * The parents with how many of their subtasks are closed: all of them less the open ones among `parents` and `tasks`.
 * A read gives every open task, so the subtasks it lacks are closed.
 */
export function parentRows(parents: Task[], tasks: Task[]): ParentTask[] {
  const open = [...parents, ...tasks].filter((task) => task.parent !== null && isOpen(task.status))
  return parents.map((parent) => ({ ...parent, closedSubtasks: Math.max(0, parent.subtasks - open.filter((task) => task.parent === parent.id).length) }))
}

export interface ParentCloserOptions {
  children: (parent: string) => Promise<Task[]>
  /** `false` — the parent was already closed. `status` — the done status to close it into; none — the tracker's first. */
  complete: (task: string, status?: string) => Promise<boolean>
  onError?: (error: unknown) => void
}

/**
 * Closes a parent task once all its subtasks are closed and at least one is done; a parent whose subtasks were all
 * canceled is left to the user. The tracker is asked for the subtasks only when none of them is open among the known tasks.
 */
export class ParentCloser {
  constructor(private readonly options: ParentCloserOptions) {}

  async sweep(parents: Task[], tasks: Task[], status?: string): Promise<string[]> {
    const known = [...parents, ...tasks]
    const closed: string[] = []
    for (const parent of parents) {
      if (known.some((task) => task.parent === parent.id && isOpen(task.status))) continue
      try {
        if (!finished(await this.options.children(parent.id))) continue
        if (await (status === undefined ? this.options.complete(parent.id) : this.options.complete(parent.id, status))) closed.push(parent.id)
      } catch (error) {
        this.options.onError?.(error)
      }
    }
    return closed
  }
}

function finished(children: Task[]): boolean {
  return children.some((task) => task.status.category === 'Won') && !children.some((task) => isOpen(task.status))
}
