import type { CiVerdict, RedRun } from '../ci/verdict.js'
import type { FinishOutcome } from '../git/types.js'
import type { Language } from '../language.js'
import type { Notice } from '../notice/notice.js'
import type { Task } from '../tracker/model.js'
import type { NewTask } from '../tracker/source.js'
import type { Opened, PullRequest, ReviewCheck } from '../review/model.js'
import type { ChainRules } from './rules.js'
import type { AccountNow, HandoffReason, HandoffSession, LimitedSession, LimitHold, RelayAction } from './relay.js'

export interface CurrentTask {
  task: string
  sessionId: string | null
  since: string
  resumedAt?: string
  limit?: LimitHold
  /** When the dispatcher began launching or handing the task over; gone once the new session id is known. */
  starting?: string
  /** The start is the user's answer going to the same session, not a new one. */
  answering?: true
  /** What the start of a running task's session is; a service restart cut short keeps it for the chain to see it through. */
  move?: Move
  /** The answer being delivered, and the question it answers. */
  reply?: string
  ask?: string
}

export type Move = 'answer' | RelayAction | 'restart' | 'checkpoint' | 'review'

export interface ActiveChain {
  project: string
  current: CurrentTask | null
  paused: boolean
  error: Notice | null
  limitUntil?: string
  /** Unattended, a launch refused for want of a slot leaves the chain running; `at` is the last attempt. */
  slotWait?: { notice: Notice; at: string }
  /**
   * The next launch waits for the CI's verdict on this push of main; `local` — for the project's own check of it,
   * `after` — for the project's `commands.afterGreen` on it.
   */
  ciWait?: { commit: string; since: string; local?: true; after?: true }
  closing?: string
  /** The task whose working session a red main stopped (BTN-115); it goes on once the fix is judged. */
  interrupted?: Interrupted
  /** The chain exists only for the fix session of a red main and ends with it. */
  fixOnly?: true
}

export interface Interrupted {
  task: string
  sessionId: string
  /** When the chain took the task. */
  since: string
  /** When the session was stopped. */
  at: string
  /** The red commit of main. */
  commit: string
  /** Main after the fix landed; unset — the fix was skipped. */
  fixed?: string
}

export interface Leftover {
  task: string
  at: string
  notice: Notice
}

export interface ChainState {
  /** Running and paused chains in start order; at most `parallel` of them take new chains from the queue. */
  active: ActiveChain[]
  queue: string[]
  orders: Record<string, string[]>
  skipped: Record<string, string[]>
  leftovers: Record<string, Leftover[]>
  released: Record<string, string[]>
  unattended: boolean
  /** Chain sessions start without claude.ai skills and plugins and with the hidden skills only for `/name`. */
  trimTools: boolean
  /** What the CI said of each project's main and what the chain waits on. */
  ci: Record<string, MainGate>
  /** The pull requests Even Keel opened for the project's tasks in PR mode (BTN-205), until each is closed and cleaned up after. */
  reviews: Record<string, PullRequest[]>
}

/** A push of main by the cleanup after Done that the CI has not judged yet. */
export interface MainPush {
  commit: string
  /** When Even Keel pushed it. */
  at: string
  /** The tasks it brought, with those of earlier pushes not judged before it came. */
  tasks: string[]
  /** Main's tree is the tree of the last task's branch, which the project's check ran on before the merge. */
  checked?: true
}

export interface MainGate {
  /** The last commit of main the CI or the project's check passed. */
  green?: string
  check?: MainPush
  /** A push the CI could not judge: the project's check runs on it in the next task's place before that task starts. */
  local?: MainPush
  /**
   * The task Even Keel created to fix a red main, from its creation until a push of it is judged. Without a task
   * (`ci.fixTask` off) `task` is the fix session's name and `report` its prompt, kept until its branch lands.
   */
  fix?: { task: string; at: string; commit: string; report?: string }
  /** The last green commit the project's `commands.afterGreen` were started on, written before they start. */
  afterGreen?: string
}

/** The fix of a red main a session without a task does or is about to do. */
export interface SessionFix {
  task: string
  commit: string
  report: string
}

export type ReleaseReason = 'postpone' | 'skip'

/** How the fix of a red main ended (BTN-153): its branch landed in main, or the user gave it up and main stayed as it was. */
export type FixOutcome = 'landed' | 'dropped'

export interface LaunchEntry {
  at: string
  project: string
  task: string
  sessionId: string
  /** `review` — a pull request opened on the session's mark, or its feedback delivered to the task's session. */
  reason?: RelayAction | ReleaseReason | FixOutcome | 'restart' | 'checkpoint' | 'answer' | 'review'
  previous?: string
  blockers?: string[]
  /** The commit of main the entry of a fix is about: red at its launch, the one main went out at when it landed. */
  commit?: string
  /** The provider of the task's run label the pool had no account for: the session started on the project's (schema v8). */
  fallback?: string
}

/** A session the chain started: its id, and the provider of a run label it could not honour (`LaunchEntry.fallback`). */
export interface Launched {
  sessionId: string
  fallback?: string
}

export interface ProjectOrder {
  order: string[]
  waiting: string[]
  /** The waiting blockers missing from the project task list (parents, other projects); set when there are any. */
  outside?: Task[]
  /** Open tasks the chain does not take yet by their status or a missing required label, and that no chain task waits on. */
  backlog: string[]
  /**
   * For the backlog tasks and the project's own waiting blockers the chain would take once their status is active: the chain
   * task each would stand right before, `null` for the end. Set when there are any.
   */
  landing?: Record<string, string | null>
  /** Those of them whose move would leave the chain without an order, with the reason. Set when there are any. */
  refused?: Record<string, Notice>
  /** The project's tasks with a pull request open or closed but not cleaned up after; set when there are any. */
  reviews?: ReviewView[]
  error: Notice | null
}

export interface ReviewView {
  task: string
  number: number
  url: string
  /** Feedback waits for the task's session. */
  feedback: boolean
  closed?: PullRequest['closed']
}

/** How the cleanup after a task with a pull request goes: its branch is deleted unmerged and on the pull request's remote. */
export interface PullCleanup {
  force: true
  remote: string
  /** Closed without a merge: the task is not done, so it is not archived. */
  unmerged?: true
}

/** PR mode (BTN-205): a task's session marks its turn's end, Even Keel pushes its branch and opens a pull request. */
export interface ReviewDeps {
  /** The project's `pullRequests` setting. */
  on: (project: string) => boolean
  /**
   * Pushes the branch of the session's folder and opens its pull request, or finds the open one. `null` — the branch
   * has nothing beyond main and its worktree is clean: there is nothing to open.
   */
  open: (project: string, task: string, session: HandoffSession) => Promise<(Opened & { remote: string }) | null>
  check: (project: string, pull: PullRequest) => Promise<ReviewCheck>
  /** Moves the task of a merged pull request, or of one with nothing to open, to Done in the tracker; one closed already is fine. */
  complete: (project: string, task: string) => Promise<void>
}

export interface DispatcherDeps {
  /** The projects of the config as it is now. */
  projects: () => string[]
  /** How many chains run at once; the rest wait in the queue. */
  parallel: () => number
  rules: (project: string) => ChainRules
  /**
   * Starts a new session of the task; `fallback` — its run label named a provider without an account in the pool.
   * `extra` goes at the end of the prompt: the feedback on the task's pull request, or its pull request closed unmerged.
   */
  launch: (project: string, task: string, extra?: string) => Promise<Launched>
  liveSession: (task: string) => string | undefined
  /** Why no session of the project starts now; `task` — the one about to start, its label may pick another agent. */
  blocked: (project: string, task?: string) => Notice | undefined
  busy: (task: string) => boolean
  midTurn: (task: string) => boolean
  /**
   * The session's turn has ended and only its own background command runs (`shell`); `busy` and `midTurn` count it
   * until the command looks hung. A merged fix or a done task does not wait for it.
   */
  shell: (task: string) => boolean
  /** The id of the `AskUserQuestion` the task's session waits on, `null` for none. */
  asked: (task: string) => string | null
  save: (state: ChainState) => void
  journal: (entry: LaunchEntry) => void
  now: () => Date
  limited: (task: string) => LimitedSession | undefined
  handoff: (task: string) => HandoffSession | undefined
  locate: (session: HandoffSession) => Promise<HandoffSession>
  /** The account a new session of the project (or of `task`) would start on. */
  account: (project: string, task?: string) => AccountNow
  accountAt: (account: string, at: string) => string | null
  /** When the spent limit of the account the project's session (or `task`'s) would start on resets; `null` — not spent. */
  limitReset: (project: string, task?: string) => string | null
  /** When the limit an account folder hit at `at` resets, by its polled limits (`limitResetAfter`); an API account's — when its key's credit came back. */
  limitResetAfter: (account: string, at: string) => string | null
  /** The project's set of packages has a problem that holds its sessions (BTN-174): not installed, no key, no answer. */
  packagesBlocked: (project: string) => boolean
  promptLanguage: () => Language
  /** The main branch of the task's project, which the prompts name. */
  mainBranch: (task: string) => string
  /** Whether the task's project is in PR mode, which the prompts name; absent — it is not. */
  pullRequests?: (task: string) => boolean
  resume:(task: string, session: LimitedSession) => Promise<string>
  /** Stops the waiting session and resumes it with the user's reply; returns the session id it came up under. */
  reply: (task: string, session: HandoffSession, prompt: string) => Promise<string>
  relay: (task: string, session: HandoffSession, prompt: string, reason: HandoffReason) => Promise<string>
  /** Starts the session that fixes a red main without a task, in a place of its own; `report` says what broke. */
  launchFix: (project: string, name: string, report: string) => Promise<string>
  /** Stops a session, mid-turn too (`claude stop`): only for a red main, invariant 1's exception 7. */
  stop: (session: HandoffSession) => Promise<void>
  /** Cleans up after the task; `pull` — after a task whose pull request was closed. */
  finish: (project: string, task: string, pull?: PullCleanup) => Promise<FinishOutcome>
  /** Reads the project's tasks from its tracker anew and hands them over (`setTasks`); resolves once done or failed. */
  refresh: (project: string) => Promise<void>
  log: (message: string) => void
  /** Without it the chain neither waits for the CI after a push of main nor reacts to a red one. */
  main?: MainCheckDeps
  /** Without it no project is in PR mode. */
  reviews?: ReviewDeps
}

export interface MainCheckDeps {
  /** The commit main is at in the project's checkout; `null` — unknown. */
  head: (project: string) => Promise<string | null>
  /** What the project's counted CIs say of a commit pushed at `since`. */
  verdict: (project: string, commit: string, since: string) => CiVerdict
  /** How long the next launch waits for the verdict: `null` — as long as it takes, `0` — not at all. */
  waitMs: (project: string) => number | null
  report: (project: string, push: MainPush, failure: MainFailure, green: string | null) => Promise<RedReport>
  /** Creates a task in the project's tracker ready for the chain; `null` — the tracker cannot create tasks. */
  create: (project: string, task: Omit<NewTask, 'project'>) => Promise<string | null>
  comment: (task: string, body: string) => Promise<void>
  /** Prepares the place of the next task while the chain waits; its launch then reuses it. */
  prepare: (project: string, task: string) => Promise<void>
  /** The tree of the task's branch, read before the cleanup deletes it; `null` — no branch. */
  taskTree: (project: string, task: string) => Promise<string | null>
  tree: (project: string, commit: string) => Promise<string | null>
  /** The project's check (BTN-104): no commands — none; `recheck` — run it on main when main is not what it ran on. */
  checking: (project: string) => { commands: string[]; recheck: boolean }
  /** Runs the project's check on main in the place of the task about to start, which keeps it for the launch. */
  checkMain: (project: string, task: string, commit: string) => Promise<MainCheckRun>
  /** `ci.fixTask`: a red main becomes a task in the tracker rather than a session without one. */
  fixTask: (project: string) => boolean
  /** Whether the branch of the task, or of the fix session, is in main with commits of its own. */
  merged: (project: string, task: string) => Promise<boolean>
  /** Whether the project has `commands.afterGreen` (BTN-156). */
  afterGreen: (project: string) => boolean
  /** Runs them in the project's checkout, if it is on main at `commit`. */
  runAfterGreen: (project: string, commit: string) => Promise<AfterGreenRun>
}

export type AfterGreenRun = { state: 'done' } | { state: 'failed'; failure: CheckFailure } | { state: 'skipped'; reason: string }

/** The first command of the project's check that failed, with its output. */
export interface CheckFailure {
  command: string
  code: number
  output: string
}

export type MainCheckRun = { state: 'green' } | { state: 'red'; failure: CheckFailure } | { state: 'skipped'; reason: string }

/** What found main red: the CI's failed runs or the project's own check. */
export type MainFailure = { ci: RedRun[] } | { check: CheckFailure }

/** The fix task's title and description, the comment for a fix task already open, and the prompt of a fix session without a task. */
export interface RedReport {
  title: string
  description: string
  comment: string
  prompt: string
}

export function emptyChainState(): ChainState {
  return { active: [], queue: [], orders: {}, skipped: {}, leftovers: {}, released: {}, unattended: false, trimTools: true, ci: {}, reviews: {} }
}

export function newChain(project: string): ActiveChain {
  return { project, current: null, paused: false, error: null }
}
