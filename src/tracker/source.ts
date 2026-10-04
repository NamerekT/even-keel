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
  /**
   * Optional. The direct subtasks of a task, whatever their status. With it and `complete` Even Keel closes
   * a parent task once all its subtasks are closed (`src/tracker/parents.ts`).
   */
  children?(id: string): Promise<TrackerTask[]>
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
  /**
   * The link to a task of the project on the page, as a template: `{id}` stands for the task id (`ABC-12`),
   * `{number}` for its number (`12`). `null` — no links. `project` is `null` for a task of a project
   * missing from `even-keel.config.json` (the stats show them).
   */
  issueUrl(project: string | null): string | null
}

/** A key of a project's object in `even-keel.config.json` that names the project in the tracker. */
export interface TrackerProjectKey {
  /** The key, e.g. `github`. Every project on this tracker must have it, unless it is `optional`. */
  key: string
  /** A project may leave it out (Linear: the key narrows a team down to one of its projects). */
  optional?: boolean
  /** What its value must look like. */
  pattern: RegExp
  /** A value for the error message, e.g. `octo-org/example`. */
  example: string
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
  /** Optional. For a tracker whose projects are not named by the project key alone (GitHub: `owner/name`). */
  projectKey?: TrackerProjectKey
  /**
   * `undefined` — none of its variables are set and the tracker is off; throws when they are set only in part.
   * `projects` — the value of `projectKey` by project key, for the projects on this tracker that have it; empty without `projectKey`.
   */
  setup(env: Record<string, string | undefined>, projects: Readonly<Record<string, string>>): TrackerSetup | undefined
}

export interface ChainTasks {
  tasks: Task[]
  /** Tasks with subtasks that are open by the rules; they never enter the chain. */
  parents: Task[]
  unknownStatuses: string[]
}

export interface Tracker {
  chainTasks(project: string, rules: ChainRules): Promise<ChainTasks>
  tasks(ids: string[]): Promise<Task[]>
  brief?(id: string): Promise<TaskBrief>
  complete?(id: string): Promise<boolean>
  children?(id: string): Promise<Task[]>
  close(): Promise<void>
}

export function trackerOf(source: TaskSource): Tracker {
  const tracker: Tracker = {
    async chainTasks(project, rules) {
      const { tasks, statuses } = await source.chainTasks(project, (status) => !isTerminal(rules, status))
      return {
        tasks: tasks.filter(isLeaf).map(toTask),
        parents: tasks.filter((task) => !isLeaf(task) && !isTerminal(rules, task.status)).map(toTask),
        unknownStatuses: unknownStatuses(rules, statuses),
      }
    },
    tasks: async (ids) => (await source.tasks(ids)).map(toTask),
    close: () => source.close(),
  }
  if (source.brief !== undefined) tracker.brief = (id) => source.brief!(id)
  if (source.complete !== undefined) tracker.complete = (id) => source.complete!(id)
  if (source.children !== undefined) tracker.children = async (id) => (await source.children!(id)).map(toTask)
  return tracker
}
