import { isOpen, type Task } from './model.js'

export interface ParentCloserOptions {
  children: (parent: string) => Promise<Task[]>
  /** `false` — the parent was already closed. */
  complete: (task: string) => Promise<boolean>
  onError?: (error: unknown) => void
}

/**
 * Closes a parent task once all its subtasks are closed and at least one is done; a parent whose subtasks were all
 * canceled is left to the user. The tracker is asked for the subtasks only when none of them is open among the known tasks.
 */
export class ParentCloser {
  constructor(private readonly options: ParentCloserOptions) {}

  async sweep(parents: Task[], tasks: Task[]): Promise<string[]> {
    const known = [...parents, ...tasks]
    const closed: string[] = []
    for (const parent of parents) {
      if (known.some((task) => task.parent === parent.id && isOpen(task.status))) continue
      try {
        if (!finished(await this.options.children(parent.id))) continue
        if (await this.options.complete(parent.id)) closed.push(parent.id)
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
