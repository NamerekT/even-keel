import type { TaskSource, TrackerAdapter } from '../tracker/source.js'
import type { TaskStatus, TrackerTask } from '../tracker/model.js'
import { fakeTask } from '../tracker/fixture.js'

export const TODO: TaskStatus = { name: 'Todo', category: 'ToDo' }
export const ACTIVE: TaskStatus = { name: 'In Progress', category: 'Active' }
export const DONE: TaskStatus = { name: 'Done', category: 'Won' }
const STATUSES = [{ name: 'Backlog', category: 'UnStarted' }, TODO, ACTIVE, DONE, { name: 'Canceled', category: 'Lost' }] as const

/** The name the board's tracker goes under in `ADAPTERS` and in a project's `tracker`. */
export const BOARD_TRACKER = 'board'
/** The board's one variable: a profile of the tracker needs a value to be on. */
export const BOARD_VARIABLE = 'BOARD_TOKEN'

/** A tracker in memory: the scenario files tasks on it and reads what the service did to them. */
export class Board {
  readonly tasks = new Map<string, TrackerTask>()
  readonly comments = new Map<string, string[]>()

  add(id: string, ...blockedBy: string[]): void {
    this.tasks.set(id, { ...fakeTask(id), blockedBy })
  }

  status(id: string): string {
    return this.tasks.get(id)!.status.name
  }

  commentsOf(id: string): string[] {
    return this.comments.get(id) ?? []
  }

  /** The adapter to register in `ADAPTERS`: every profile and project reads this board. */
  adapter(): TrackerAdapter {
    return {
      title: 'Board',
      variables: [BOARD_VARIABLE],
      hostVariables: [],
      help: '',
      profileName: () => 'Board',
      account: async () => ({ login: 'john', name: 'Board', expiresAt: null }),
      projects: async () => [],
      setup: (env) => (env[BOARD_VARIABLE] === undefined ? undefined : { connect: async () => this.source(), issueUrl: () => null }),
    }
  }

  private source(): TaskSource {
    const copy = (task: TrackerTask) => structuredClone(task)
    return {
      chainTasks: async (_project, open) => ({ tasks: [...this.tasks.values()].filter((task) => open(task.status)).map(copy), statuses: STATUSES.map((status) => status.name) }),
      tasks: async (ids) => ids.flatMap((id) => (this.tasks.has(id) ? [copy(this.tasks.get(id)!)] : [])),
      brief: async (id) => ({ title: this.tasks.get(id)?.title ?? id, description: '' }),
      complete: async (id) => {
        const task = this.tasks.get(id)
        if (task === undefined || task.status.category === 'Won' || task.status.category === 'Lost') return false
        task.status = DONE
        return true
      },
      comment: async (id, body) => {
        const list = this.comments.get(id) ?? []
        list.push(body)
        this.comments.set(id, list)
        return `${id}-comment-${list.length}`
      },
      commentsAfter: async () => [],
      close: async () => {},
    }
  }
}
