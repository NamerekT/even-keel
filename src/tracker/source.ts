import { isTerminal, unknownStatuses, type ChainRules } from '../chain/rules.js'
import { isLeaf, toTask, type Task, type TaskStatus, type TrackerTask } from './model.js'

/**
 * The contract of a tracker adapter. Baton reads tasks through it and never talks to a tracker directly;
 * Huly (`src/huly/adapter.ts`) is one implementation. An adapter is registered in `src/tracker/adapters.ts`
 * and picked by name with `tracker` in `baton.config.json`, for all projects or per project.
 *
 * A task the adapter returns (`TrackerTask`):
 * - `id` — `<PROJECT>-<number>`, where PROJECT is the project key from `baton.config.json`; Baton names the
 *   worktree and the branch after it and the stats attribute sessions to a task by it.
 * - `status` — the tracker's status name and one of five categories: `UnStarted` (backlog), `ToDo` (ready),
 *   `Active` (in progress or review), `Won` (done), `Lost` (canceled). The chain rules work on these.
 * - `blockedBy` — ids of the tasks that block this one; `parent` — the id of the parent task;
 *   `subtasks` — how many subtasks it has: a task with subtasks never enters the chain.
 * - `labels` as they are named in the tracker; Baton derives the model and the question mark from them.
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
   * Optional. The text of a task for the launch prompt, when the agent has no other way to read it
   * (no MCP server of the tracker). Huly leaves it out: its sessions read the task through MCP.
   */
  brief?(id: string): Promise<TaskBrief>
  /**
   * Optional. Moves a task to a `Won` status; Baton calls it once it sees the task's branch merged into `main`.
   * Huly leaves it out: a git hook closes the task on merge.
   */
  complete?(id: string): Promise<void>
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
  /** Environment variables the adapter reads; Baton keeps them out of the sessions it launches. */
  variables: readonly string[]
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
  complete?(id: string): Promise<void>
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
