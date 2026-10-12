import type { CiVerdict, RedRun } from '../ci/verdict.js'
import type { FinishOutcome } from '../git/types.js'
import type { Language } from '../language.js'
import type { Notice } from '../notice/notice.js'
import type { Task } from '../tracker/model.js'
import type { NewTask } from '../tracker/source.js'
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
}

export interface ActiveChain {
  project: string
  current: CurrentTask | null
  paused: boolean
  error: Notice | null
  limitUntil?: string
  /** Unattended, a launch refused for want of a slot leaves the chain running; `at` is the last attempt. */
  slotWait?: { notice: Notice; at: string }
  /** The next launch waits for the CI's verdict on this push of main; `local` — for the project's own check of it. */
  ciWait?: { commit: string; since: string; local?: true }
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
}

/** The fix of a red main a session without a task does or is about to do. */
export interface SessionFix {
  task: string
  commit: string
  report: string
}

export type ReleaseReason = 'postpone' | 'skip'

export interface LaunchEntry {
  at: string
  project: string
  task: string
  sessionId: string
  reason?: RelayAction | ReleaseReason | 'restart' | 'checkpoint' | 'answer'
  previous?: string
  blockers?: string[]
}

export interface ProjectOrder {
  order: string[]
  waiting: string[]
  /** The waiting blockers missing from the project task list (parents, other projects); set when there are any. */
  outside?: Task[]
  /** Open tasks the chain does not take yet by their status or a missing required label, and that no chain task waits on. */
  backlog: string[]
  /**
   * For the backlog tasks the chain would take once their status is active: the chain task each would stand right before,
   * `null` for the end. Set when there are any.
   */
  landing?: Record<string, string | null>
  error: Notice | null
}

export interface DispatcherDeps {
  projects: string[]
  /** How many chains run at once; the rest wait in the queue. */
  parallel: () => number
  rules: (project: string) => ChainRules
  launch: (project: string, task: string) => Promise<string>
  liveSession: (task: string) => string | undefined
  blocked: () => Notice | undefined
  busy: (task: string) => boolean
  midTurn: (task: string) => boolean
  /** The id of the `AskUserQuestion` the task's session waits on, `null` for none. */
  asked: (task: string) => string | null
  save: (state: ChainState) => void
  journal: (entry: LaunchEntry) => void
  now: () => Date
  limited: (task: string) => LimitedSession | undefined
  handoff: (task: string) => HandoffSession | undefined
  locate: (session: HandoffSession) => Promise<HandoffSession>
  account: () => AccountNow
  accountAt: (account: string, at: string) => string | null
  limitReset: () => string | null
  promptLanguage: () => Language
  /** The main branch of the task's project, which the prompts name. */
  mainBranch: (task: string) => string
  resume:(task: string, session: LimitedSession) => Promise<string>
  /** Stops the waiting session and resumes it with the user's reply; returns the session id it came up under. */
  reply: (task: string, session: HandoffSession, prompt: string) => Promise<string>
  relay: (task: string, session: HandoffSession, prompt: string, reason: HandoffReason) => Promise<string>
  /** Starts the session that fixes a red main without a task, in a place of its own; `report` says what broke. */
  launchFix: (project: string, name: string, report: string) => Promise<string>
  /** Stops a session, mid-turn too (`claude stop`): only for a red main, invariant 1's exception 7. */
  stop: (session: HandoffSession) => Promise<void>
  finish: (project: string, task: string) => Promise<FinishOutcome>
  log: (message: string) => void
  /** Without it the chain neither waits for the CI after a push of main nor reacts to a red one. */
  main?: MainCheckDeps
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
}

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
  return { active: [], queue: [], orders: {}, skipped: {}, leftovers: {}, released: {}, unattended: false, trimTools: true, ci: {} }
}

export function newChain(project: string): ActiveChain {
  return { project, current: null, paused: false, error: null }
}
