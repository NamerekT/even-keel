import { isTerminal, unknownStatuses, type ChainRules } from '../chain/rules.js'
import type { RemoteRepo } from '../ci/remote.js'
import type { TrackerCard } from './card.js'
import { isLeaf, toTask, type MilestonePick, type Task, type TaskPriority, type TaskStatus, type TrackerTask } from './model.js'

export interface TaskFile {
  /** MIME type; empty when unknown. */
  type: string
  /** bytes; `null` when unknown */
  size: number | null
  body: AsyncIterable<Uint8Array>
}

/**
 * The contract of a tracker adapter. Even Keel reads tasks through it and never talks to a tracker directly;
 * Huly (`src/huly/adapter.ts`) is one implementation. An adapter is registered in `src/tracker/adapters.ts`
 * and picked by name with `tracker` in `even-keel.config.json`, for all projects or per project.
 *
 * A `project` the methods take is the Even Keel project's id; its key and its tracker project are in the `projects`
 * the adapter's `setup` got (`TrackerPlace`): two projects may share a key (BTN-271).
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
   * Closed tasks the chain ran recently Even Keel requests itself, through `tasks`.
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
   * Optional. How a pull request names the task's issue to close it on merge: GitHub issues `owner/repo#N`, GitLab
   * issues the issue's address; `null` — not a task of this tracker. In PR mode Even Keel ends the body of the task's
   * pull request on the same forge with `Closes <it>` (BTN-295, BTN-414, `closingOf`).
   */
  closingRef?(id: string): string | null
  /**
   * Optional. The direct subtasks of a task, whatever their status. With it and `complete` Even Keel closes
   * a parent task once all its subtasks are closed (`src/tracker/parents.ts`).
   */
  children?(id: string): Promise<TrackerTask[]>
  /**
   * Optional. The task in full — description, links to other tasks, comments — for its card on the page.
   * Without it the page has no card and offers only the link to the task.
   */
  card?(id: string): Promise<TrackerCard>
  /**
   * Optional. The content of a file from the task's card whose `url` is `null`, by its `file`;
   * `null` — the task has no such file. The page gets it through the service, which holds the tracker's credentials.
   */
  file?(id: string, file: string): Promise<TaskFile | null>
  /**
   * Optional. Moves an `UnStarted` task to the tracker's first `ToDo` status; the card offers it for a task in the backlog.
   * Returns the new status; `null` — the task is not `UnStarted` and was left alone.
   */
  ready?(id: string): Promise<TaskStatus | null>
  /**
   * Optional. Posts a Markdown comment on the task and returns its id. With `commentsAfter` Even Keel puts a session's
   * `AskUserQuestion` to the user in the tracker and passes the reply comment on to the session.
   */
  comment?(id: string, body: string): Promise<string>
  /**
   * Optional. The comments on the task posted after the comment `after`, oldest first; `[]` when `after` is gone.
   * `files` are the comment's files, each by what `file(id, file)` serves.
   */
  commentsAfter?(id: string, after: string): Promise<TrackerComment[]>
  /**
   * Optional. Creates a task in the tracker's first `ToDo` status, so the chain takes it, and returns its id.
   * Even Keel creates the task to fix a red CI on `main` with it; without it the chain only stops.
   */
  create?(task: NewTask): Promise<string>
  /**
   * Optional. Puts a task that has no milestone into the milestone of the task `milestoneOf`; with it and a project's
   * `fillMilestone` Even Keel gives the active milestone to a task that entered the chain without one.
   * Must do nothing and return `false` for a task that has a milestone by now, and when `milestoneOf` has none.
   */
  setMilestone?(id: string, milestoneOf: string): Promise<boolean>
  /**
   * Optional, together with `moveMilestone`. The milestones the task can be put into — the open ones of the place a
   * milestone belongs to (a Huly project, a GitHub repository, a Linear project), plus the task's own if it is closed —
   * and the id of the task's own. With both the card's milestone becomes a pick.
   */
  milestones?(id: string): Promise<MilestonePick>
  /** Optional, together with `milestones`. Puts the task into the milestone with this id from `milestones`; `null` — into none. */
  moveMilestone?(id: string, milestone: string | null): Promise<void>
  /**
   * Optional. Every task of the project's milestone named `milestone`, whatever its status, each with its last comment;
   * `[]` — the project has no such milestone. With it the page offers a changelog draft of the milestone (`src/changelog/`).
   */
  milestoneTasks?(project: string, milestone: string): Promise<MilestoneTask[]>
  /**
   * Optional. The status names and the labels a task of the project can have, whether or not a task has them now;
   * the settings offer them in the chain rules. Without it the rules offer only what the loaded tasks carry.
   */
  vocabulary?(project: string): Promise<TrackerVocabulary>
  /**
   * Optional. Whether anyone at all can open a task in the project (a public GitHub repository): the wizard then warns
   * that without `chain.requiredLabels` such a task enters the chain. Without it the tracker is taken as closed.
   */
  isPublic?(project: string): Promise<boolean>
  /** Drops the connection. */
  close(): Promise<void>
}

/** A task of a milestone for its changelog draft (`TaskSource.milestoneTasks`). */
export interface MilestoneTask extends TrackerTask {
  /** Markdown of the task's last comment, the closing one of its session as a rule; `null` — it has none. */
  lastComment: string | null
}

export interface TrackerVocabulary {
  /** With their categories: the settings show what each status does by default (BTN-334). */
  statuses: TaskStatus[]
  labels: string[]
  /** The project's open milestones, for `chain.requiredMilestones`; a tracker without milestones leaves it out. */
  milestones?: string[]
}

export interface NewTask {
  /** The project's id, as the other methods take it. */
  project: string
  title: string
  /** Markdown. */
  description: string
  priority: TaskPriority
  /** The new task goes into the milestone of this task, if it has one; `null` — into none. */
  milestoneOf: string | null
}

export interface TrackerComment {
  id: string
  /** Markdown. */
  body: string
  files: { name: string; file: string }[]
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
  /**
   * Optional. The project's own page in the tracker, where the user files tasks: the card of a project with nothing
   * open leads there. `null` — not known (yet: an adapter may learn it on the first read of the tasks).
   */
  projectUrl?(project: string): string | null
}

/** A key of a project's object in `even-keel.config.json` that names the project in the tracker. */
export interface TrackerProjectKey {
  /** The key, e.g. `github`. Every project on this tracker must have it, unless it is `optional`. */
  key: string
  /** A project may leave it out (Linear: the key narrows a team down to one of its projects). */
  optional?: boolean
  /**
   * The value names the tracker's project instead of the key, which then is only Even Keel's (Huly: a second project
   * of Even Keel on the same Huly project, its tasks split off by milestone). Implies `optional`: without it the key
   * is the tracker's project. The wizard picks the tracker's project and offers its key.
   */
  alias?: boolean
  /**
   * The place in the tracker a project reads, from its key and its value, when the task ids are the tracker's own and
   * not made of the key (BTN-172, BTN-73): projects with the same place read it once and must split its tasks by
   * milestone, projects with different places may share a key-free part of the tracker (two Linear projects of one
   * team). `ids` — the prefix of the task ids there (`NAM` of `NAM-12`). Without it the key is both: projects with one
   * key read one place, so they must name the same tracker project (GitHub: the ids of two repositories would clash).
   */
  placeOf?: (key: string, value: string | undefined) => { read: string; ids: string }
  /** What its value must look like. */
  pattern: RegExp
  /** A value for the error message, e.g. `octo-org/example`. */
  example: string
}

/** Whom a profile's credentials sign in as (`TrackerAdapter.account`). */
export interface ProfileAccount {
  /** The login or the person's name, for "signed in as …". */
  login: string
  /** The profile's name to offer: `GitHub · octo-org`. */
  name: string
  /** When the credentials expire, if the tracker says (GitHub's fine-grained tokens); ISO. */
  expiresAt: string | null
}

/** The tracker refused the credentials, as opposed to not answering: a profile with them is red and its chains wait. */
export class CredentialsRefused extends Error {}

/**
 * The tracker answered that what it was asked for — a project, a team, an issue — is not there or not visible to the
 * credentials: the call failed, the connection did not, and `TrackerLink` keeps it for the other projects of the profile.
 */
export class TrackerNotFound extends Error {}

/** A project of the tracker a profile sees, for the wizard to pick from (`TrackerAdapter.projects`). */
export interface TrackerProject {
  /** What the project's entry takes: the Huly identifier, GitHub's `owner/name`, the Linear team key. */
  key: string
  name: string
  /** Linear: the team's project the entry narrows the team to (`projectKey`); the key is the team's then. */
  within?: string
}

export interface TrackerAdapter {
  /** The name on the page and in the log. */
  title: string
  /**
   * The variables a profile of the adapter holds, by name; they were environment variables before profiles (BTN-200)
   * and are still the names the tracker's MCP server reads. Even Keel keeps them out of the sessions it launches.
   */
  variables: readonly string[]
  /** The variables that say where the tracker is (Huly: the address and the workspace): fixed while projects use the profile. */
  hostVariables: readonly string[]
  /** Optional. Sets of variables of which a profile fills one (Huly: a token, or an e-mail and a password). */
  alternatives?: readonly (readonly string[])[]
  /** Where to get the credentials, with the rights a profile needs. */
  help: string
  /** The name a profile of these values gets before the user names it; `account` — what the tracker answered, if it did. */
  profileName(values: Readonly<Record<string, string>>, account: ProfileAccount | null): string
  /** Whom the values sign in as; throws `CredentialsRefused` when the tracker refuses them, another error when it does not answer. */
  account(values: Readonly<Record<string, string>>, timeoutMs: number): Promise<ProfileAccount>
  /** The tracker's projects the values see whose key or name has `query` in it (case-insensitively), at most 50. */
  projects(values: Readonly<Record<string, string>>, query: string, timeoutMs: number): Promise<TrackerProject[]>
  /**
   * Optional. The name of the tracker's MCP server. With `brief` off Even Keel looks for it where the CLI would
   * for the project folder and warns when it is missing: the sessions would get nothing but the task id.
   */
  mcpServer?: string
  /**
   * Optional. By placeholder of the tracker plugin's `.mcp.json`, the adapter's variable that holds its value
   * (`GITHUB_PERSONAL_ACCESS_TOKEN` ← `GITHUB_TOKEN`): the MCP gateway fills it from the same pool of keys.
   */
  mcpKeys?: Readonly<Record<string, string>>
  /** Optional. For a tracker whose projects are not named by the project key alone (GitHub: `owner/name`). */
  projectKey?: TrackerProjectKey
  /** Optional. The value of `projectKey` a git remote of the repository suggests (GitHub: `owner/name` of a github.com remote). */
  projectOfRemote?(remote: RemoteRepo): string | undefined
  /**
   * `env` — a profile's values. `undefined` — none of its variables are set and the tracker is off; throws when they are
   * set only in part. `projects` — the place of each project on this profile, by its id.
   */
  setup(env: Record<string, string | undefined>, projects: Readonly<Record<string, TrackerPlace>>): TrackerSetup | undefined
}

/** A project as its tracker's adapter knows it: the key from `even-keel.config.json` and the value of `projectKey`, if any. */
export interface TrackerPlace {
  key: string
  value?: string
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
  closingRef?(id: string): string | null
  children?(id: string): Promise<Task[]>
  card?(id: string): Promise<TrackerCard>
  file?(id: string, file: string): Promise<TaskFile | null>
  ready?(id: string): Promise<TaskStatus | null>
  comment?(id: string, body: string): Promise<string>
  commentsAfter?(id: string, after: string): Promise<TrackerComment[]>
  create?(task: NewTask): Promise<string>
  setMilestone?(id: string, milestoneOf: string): Promise<boolean>
  milestones?(id: string): Promise<MilestonePick>
  moveMilestone?(id: string, milestone: string | null): Promise<void>
  milestoneTasks?(project: string, milestone: string): Promise<MilestoneTask[]>
  vocabulary?(project: string): Promise<TrackerVocabulary>
  isPublic?(project: string): Promise<boolean>
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
  if (source.closingRef !== undefined) tracker.closingRef = (id) => source.closingRef!(id)
  if (source.children !== undefined) tracker.children = async (id) => (await source.children!(id)).map(toTask)
  if (source.card !== undefined) tracker.card = (id) => source.card!(id)
  if (source.file !== undefined) tracker.file = (id, file) => source.file!(id, file)
  if (source.ready !== undefined) tracker.ready = (id) => source.ready!(id)
  if (source.comment !== undefined) tracker.comment = (id, body) => source.comment!(id, body)
  if (source.commentsAfter !== undefined) tracker.commentsAfter = (id, after) => source.commentsAfter!(id, after)
  if (source.create !== undefined) tracker.create = (task) => source.create!(task)
  if (source.setMilestone !== undefined) tracker.setMilestone = (id, milestoneOf) => source.setMilestone!(id, milestoneOf)
  if (source.milestones !== undefined && source.moveMilestone !== undefined) {
    tracker.milestones = (id) => source.milestones!(id)
    tracker.moveMilestone = (id, milestone) => source.moveMilestone!(id, milestone)
  }
  if (source.milestoneTasks !== undefined) tracker.milestoneTasks = (project, milestone) => source.milestoneTasks!(project, milestone)
  if (source.vocabulary !== undefined) tracker.vocabulary = (project) => source.vocabulary!(project)
  if (source.isPublic !== undefined) tracker.isPublic = (project) => source.isPublic!(project)
  return tracker
}
