import type { Task } from '../tracker/model.js'
import type { ClosedTask } from './store.js'

/**
 * The project's tasks of the archive closed since `since` that its trackers no longer give (BTN-66): a feed or a profile
 * gone, a task deleted. The page shows them as closed by the status the tracker last gave.
 */
export function archivedShown(archive: readonly ClosedTask[], project: string, listed: readonly Task[], since: Date): Task[] {
  const ids = new Set(listed.map((task) => task.id))
  return archive.flatMap((closed) =>
    closed.project !== project || ids.has(closed.task) || !(Date.parse(closed.closedAt) >= since.getTime())
      ? []
      : [
          {
            id: closed.task,
            title: closed.title,
            status: { name: closed.status ?? 'Done', category: 'Won' as const },
            blockedBy: [],
            parent: null,
            subtasks: 0,
            milestone: null,
            priority: 'none' as const,
            labels: [],
            estimate: null,
            question: false,
            runLabels: [],
          },
        ],
  )
}
