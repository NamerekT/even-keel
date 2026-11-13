import { taskRunText, type TaskRun } from '../../../src/sessions/runs.js'
import type { Task } from '../../../src/tracker/model.js'

/** How many backlog rows show at first and how many each "More" adds (BTN-982). */
export const BACKLOG_PAGE = 50

const haystack = (task: Task, run: TaskRun | null): string =>
  [task.id, task.title, run === null ? '' : taskRunText(run), task.milestone?.label ?? ''].join('\n').toLowerCase()

/**
 * The backlog's tasks a search keeps, in the order given: each word of the query, case aside, is somewhere in the key,
 * the title, the run the card set or the milestone's name. A blank query keeps them all.
 */
export function searchBacklog(tasks: readonly Task[], query: string, runOf: (task: string) => TaskRun | null): Task[] {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== '')
  if (words.length === 0) return [...tasks]
  return tasks.filter((task) => {
    const text = haystack(task, runOf(task.id))
    return words.every((word) => text.includes(word))
  })
}

/** The rows shown after a press of "More": one page more, never past the list. */
export const nextLimit = (limit: number, total: number): number => Math.min(limit + BACKLOG_PAGE, Math.max(limit, total))
