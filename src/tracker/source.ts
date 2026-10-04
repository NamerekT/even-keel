import { isTerminal, unknownStatuses, type ChainRules } from '../chain/rules.js'
import { isLeaf, toTask, type Task, type TaskStatus, type TrackerTask } from './model.js'

/**
 * The contract of a tracker adapter. Even Keel reads tasks through it and never talks to a tracker directly;
 * Huly (`src/huly/adapter.ts`) is one implementation. An adapter is registered in `src/tracker/adapters.ts`
 * and picked by name with `tracker` in `even-keel.config.json`, for all projects or per project.
 *
 * A task the adapter returns (`TrackerTask`):
 * - `id` — `<PROJECT>-<number>`, where PROJECT is the project key from `even-keel.config.json`; Even Keel names the
 *   worktree and the branch after it and the stats attribute sessions to a task by it.
 * - `status` — the tracker's status name and one of five categories: `UnStarted` (backlog), `ToDo` (ready),
 *   `Active` (in progress or review), `Won` (done), `Lost` (canceled). The chain rules work on these.
 * - `blockedBy` — ids of the tasks that block this one; `parent` — the id of the parent task;
 *   `subtasks` — how many subtasks it has: a task with subtasks never enters the chain.
 * - `labels` as they are named in the tracker; Even Keel derives the model and the question mark from them.
 * - `priority`, `milestone` (`targetDate` in ms), `estimate` (hours).
 * Whatever the tracker lacks is returned empty: `[]`, `null`, `0`, `'none'`. The chain works without it.
 */
export interface TaskSource {
  /**
   * Tasks of a project that are open by `open`, plus closed tasks sharing a milestone with them
   * (the page shows milestone progress), and the names of every status the tracker knows.
   */
  chainTasks(project: string, open: (status: TaskStatus) => boolean): Promise<TrackerTasks>
  /** The tasks with these ids, whatever their status; an id the tracker no longer has is left out. */
  tasks(ids: string[]): Promise<TrackerTask[]>
  /**
   * Optional. The title and description of a task; Even Keel adds them to the launch and handoff prompts,
   * so a session needs nothing but the adapter to know its task. `brief: false` in `even-keel.config.json`
   * turns this off for projects whose sessions read the task themselves (an MCP server of the tracker).
   */
  brief?(id: string): Promise<TaskBrief>
  /**
   * Optional. Moves a task to a `Won` status; Even Keel calls it once it sees the task's branch merged into `main`.
   * Must do nothing and return `false` for a task that is already `Won` or `Lost`: something else (a git hook, a person)
   * may have closed it first. `true` — the task was moved.
   */
  complete?(id: string): Promise<boolean>
  /** Drops the connection. */
  close(): Promise<void>
}

export interface TrackerTasks {
  tasks: TrackerTask[]
  statuses: string[]
}

export interface TaskBrief {
  title: string
  description: string
}

export interface TrackerSetup {
  connect(timeoutMs: number): Promise<TaskSource>
  /** Prefix of a task link on the page: the link is this plus the task id; `null` — no links. */
  issueUrlBase: string | null
}

export interface TrackerAdapter {
  /** The name on the page and in the log. */
  title: string
  /** Environment variables the adapter reads; Even Keel keeps them out of the sessions it launches. */
  variables: readonly string[]
  /**
   * Optional. The name of the tracker's MCP server. With `brief` off Even Keel looks for it where the CLI would
   * for the project folder and warns when it is missing: the sessions would get nothing but the task id.
   */
  mcpServer?: string
  /** `undefined` — none of its variables are set and the tracker is off; throws when they are set only in part. */
  setup(env: Record<string, string | undefined>): TrackerSetup | undefined
}

export interface ChainTasks {
  tasks: Task[]
  unknownStatuses: string[]
}

export interface Tracker {
  chainTasks(project: string, rules: ChainRules): Promise<ChainTasks>
  tasks(ids: string[]): Promise<Task[]>
  brief?(id: string): Promise<TaskBrief>
  complete?(id: string): Promise<boolean>
  close(): Promise<void>
}

export function trackerOf(source: TaskSource): Tracker {
  const tracker: Tracker = {
    async chainTasks(project, rules) {
      const { tasks, statuses } = await source.chainTasks(project, (status) => !isTerminal(rules, status))
      return { tasks: tasks.filter(isLeaf).map(toTask), unknownStatuses: unknownStatuses(rules, statuses) }
    },
    tasks: async (ids) => (await source.tasks(ids)).map(toTask),
    close: () => source.close(),
  }
  if (source.brief !== undefined) tracker.brief = (id) => source.brief!(id)
  if (source.complete !== undefined) tracker.complete = (id) => source.complete!(id)
  return tracker
}
