import type { CiVerdict, RedRun } from '../ci/verdict.js'
import type { EventDraft } from '../event-log/model.js'
import type { Changes, FinishOutcome } from '../git/types.js'
import type { Language } from '../language.js'
import type { Notice } from '../notice/notice.js'
import type { OverageSession } from '../limits/overage-session.js'
import type { Task, TaskMilestone } from '../tracker/model.js'
import type { NewTask } from '../tracker/source.js'
import type { Opened, PullRequest, ReviewCheck } from '../review/model.js'
import type { SequencedMilestone } from './milestone-sequence.js'
import type { MoveWhen } from './moves.js'
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

export type ReturnReason = 'returned' | 'unblocked' | 'unskipped'
/** `message` — "New session with this message" from the chat (BTN-757): a restart whose new session gets the user's message. */
export type Move = 'answer' | RelayAction | 'restart' | 'message' | 'checkpoint' | 'review' | ReturnReason

export interface ActiveChain {
  project: string
  current: CurrentTask | null
  paused: boolean
  error: Notice | null
  limitUntil?: string
  /**
   * The model's own week is used up on the account the next task would start on (BTN-816): the chain holds the task
   * until the week opens. `until` — when it opens, unknown without it: the poll is then the only thing that can tell.
   */
  modelWeek?: ModelWeekHold
  /** Unattended, a launch refused for want of a slot leaves the chain running; `at` is the last attempt. */
  slotWait?: { notice: Notice; at: string }
  /**
   * The next launch waits for the CI's verdict on this push of main; `local` — for the project's own check of it,
   * `after` — for the project's `commands.afterGreen` on it; `by` — for the fix of the red commit by another project
   * of the same remote (BTN-217), since that fix began.
   */
  ciWait?: { commit: string; since: string; local?: true; after?: true; by?: string }
  /** The next launch waits for its account's first limits poll since the start (BTN-595); the page shows it (BTN-619). */
  limitsWait?: LimitsWait
  closing?: string
  /** The task whose working session a red main stopped (BTN-115); it goes on once the fix is judged. */
  interrupted?: Interrupted
  /** The chain exists only for the fix session of a red main or a carry session (BTN-369) and ends with them. */
  fixOnly?: true
  /** "Stop after this task" (BTN-230): the chain sees its current task through Done and the cleanup, then stops instead of taking the next one. */
  stopAfter?: true
}

/** `account` — the folder key; `next` — when the next poll is due, `null` — one is running or waits for the accounts. */
export interface LimitsWait {
  account: string
  next: string | null
}

/** The model's own week used up on the account a session would start on (BTN-816). */
export interface ModelWeekHold {
  /** The model's name as the server gave it ("Fable"). */
  model: string
  /** When the week opens; `null` — the server named no reset, and only a poll can tell. */
  until: string | null
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
  /** Released tasks whose resting session may be replaced when they return to the chain. */
  shelved: Record<string, Shelved[]>
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
  /** Main's tree is the tree the project's check before the merge of the last task reported it passed on (EKR-103). */
  checked?: true
  /** The check before the merge of the last task sent no report: nothing shows it ran (EKR-103). */
  unreported?: true
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
  fix?: { task: string; at: string; commit: string; report?: string; reran?: true }
  /**
   * The rerun of a red commit's failed jobs (BTN-846), one per commit, kept until another commit is rerun: `runs` are
   * the failed runs as they ended then (`failedKey`) — while one is still so, the rerun has not ended.
   */
  rerun?: { commit: string; at: string; runs: string[] }
  /** The last green commit the project's `commands.afterGreen` were started on, written before they start. */
  afterGreen?: string
  /** When that run started and how it ended, for the page (BTN-829). */
  afterGreenRun?: AfterGreenRecord
  /** On a release project's gate: the carry of its branch a session resolves, from "Resolve with the agent" until it lands or is skipped. */
  carry?: CarrySession
  /**
   * The fix and carry sessions skipped in this project's chain, by name (BTN-692): alive and untouched, so a new fix or
   * carry of the same name starts a session of its own instead of taking one of these. Forgotten at the name's cleanup.
   */
  skippedSessions?: Record<string, string[]>
}

/**
 * A release project's carry git could not merge, resolved by a session without a task (BTN-369) in the project it
 * merges into (`into`). It is done once `into`'s branch has `commit`, the release branch when the user asked.
 */
export interface CarrySession {
  /** The session's name, `EKR-CARRY` (`carryNameOf`). */
  task: string
  into: string
  at: string
  commit: string
  /** The commits of the release branch `into`'s branch lacked when asked. */
  commits: number
  /** The session's prompt in `into`'s `promptLanguage`: what to merge and what conflicted. */
  report: string
}

/** The fix of a red main a session without a task does or is about to do. */
export interface SessionFix {
  task: string
  commit: string
  report: string
  /** Even Keel reran the failed jobs once and they failed again (BTN-846): the session is not to rerun them to test for a flake. */
  reran?: true
}

/** A resting session left behind by a released task; one someone talked to since is not replaced. */
export interface Shelved {
  task: string
  sessionId: string
  at: string
  /** Absent for a task that left for an inactive status, including older records. */
  reason?: ReleaseReason
  blockers?: string[]
}

export type ReleaseReason = 'postpone' | 'skip'

/**
 * How the fix of a red main ended (BTN-153): its branch landed in main, the user gave it up and main stayed as it
 * was, or its session found nothing to fix and the red commit turned green, as after a rerun (EKR-88); how a carry
 * ended (BTN-369): the release commits are in the branch, or it was given up.
 */
export type FixOutcome = 'landed' | 'dropped' | 'unneeded' | 'carried'

/**
 * Why a new session with a handoff followed a cold cache; a launch without one in the journal is a `limit`. `credit` —
 * the API key ran out of money; `message` — of a `restart`: the user sent a chat message as a new session (BTN-757);
 * `transient` — the same session resumed after a temporary model error.
 */
export type RelayCause = 'limit' | 'credit' | 'mainFixed' | 'review' | 'message' | 'transient' | ReturnReason

export interface LaunchEntry {
  at: string
  project: string
  task: string
  sessionId: string
  /**
   * `review` — the pull request feedback delivered to the task's session, or a launch with it; `opened` — a pull request
   * opened on the session's mark, no launch (BTN-863; such an entry before it is a `review` without `previous`).
   */
  reason?: RelayAction | ReleaseReason | FixOutcome | 'restart' | 'checkpoint' | 'answer' | 'review' | 'opened'
  /** What made the new session of a `relay` (or a `resume` that goes on, or a `review` handover): kept in `extra`, `reason` stays for Tally. */
  cause?: RelayCause
  previous?: string
  blockers?: string[]
  /**
   * The commit of main the entry of a fix is about: red at its launch, the one main went out at when it landed; of a
   * carry's launch — the release commit it carries.
   */
  commit?: string
  /** The release commits a carry brought, on its `carried` entry. */
  commits?: number
  /** The provider of the task's run the pool had no account for: the session started on the project's (schema v8). */
  fallback?: string
  /**
   * Where the task was read from at the launch (BTN-66): the tracker profile, the task's link and its title — Tally and
   * the archive know a task of a feed or of a profile gone since by them. Set by the service, where it knows them.
   */
  profile?: string
  url?: string
  title?: string
}

/** A session the chain started: its id, and the provider of a task's run it could not honour (`LaunchEntry.fallback`). */
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
  /** The milestone a landing preview would get on entry; absent when it keeps its own. */
  landingMilestones?: Record<string, TaskMilestone>
  /** Those of them whose move would leave the chain without an order, with the reason. Set when there are any. */
  refused?: Record<string, Notice>
  /**
   * For the chain's, the backlog's and the waiting tasks whose rules require a label: `true` — the task has one, "To the
   * backlog" takes them off; `false` — it has none, "Into the chain" puts one on (BTN-509). A task an excluded label keeps out
   * is not listed. Set when there are any.
   */
  requiredLabel?: Record<string, boolean>
  /** The project's tasks with a pull request open or closed but not cleaned up after; set when there are any. */
  reviews?: ReviewView[]
  /**
   * The milestones of the chain's and the backlog's tasks in the order the chain goes by (BTN-792): the saved one with
   * `fresh` for a milestone it lacks, else the automatic one. Set when there are any.
   */
  milestones?: SequencedMilestone[]
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

/** Out of PR mode, a task whose session marks it `NO CHANGES:` (EKR-10): nothing to merge, so no merge closes it. */
export interface UnchangedDeps {
  /** What the session's folder holds beyond the project's main branch. */
  changes: (project: string, workdir: string) => Promise<Changes>
  /** Moves the task to Done in the tracker and puts `comment` on it; one closed already is fine. */
  complete: (project: string, task: string, comment: string) => Promise<void>
  /**
   * "Accept as answer" (BTN-885): puts `comment` on the task, then moves it to Done. The comment is the answer, so
   * one that fails rejects and the task stays open.
   */
  accept: (project: string, task: string, comment: string) => Promise<void>
}

export interface DispatcherDeps {
  /** The projects of the config as it is now. */
  projects: () => string[]
  /** How many chains run at once; the rest wait in the queue. */
  parallel: () => number
  /** The project's chain rules; with a task, the rules of the feed it comes from (BTN-66), whose tracker has statuses of its own. */
  rules: (project: string, task?: string) => ChainRules
  /** The project's current `fillMilestone` setting; absent means off. */
  fillsMilestone?: (project: string) => boolean
  /** The project's saved milestone order by label (BTN-792); empty or absent — the automatic one. */
  milestoneOrder?: (project: string) => readonly string[]
  /**
   * Starts a new session of the task; `fallback` — the task's run named a provider without an account in the pool.
   * `extra` goes at the end of the prompt: the feedback on the task's pull request, or its pull request closed unmerged.
   */
  launch: (project: string, task: string, extra?: string) => Promise<Launched>
  liveSession: (task: string) => string | undefined
  /** The session of the task's newest entry in the launch journal; absent — the journal is not read. */
  lastSession?: (project: string, task: string) => string | undefined
  /**
   * Why no session of the project starts now; `task` — the one about to start, its label may pick another agent.
   * Without a task only the project's own requirements are checked, not an agent or account (BTN-521).
   */
  blocked: (project: string, task?: string) => Notice | undefined
  /** A completed turn refused its model. Reporting it pauses the chain without touching the session. */
  modelRefusal?: (task: string, sessionId: string) => Notice | undefined
  /**
   * Why the account `task` would start on refuses its model (`chain.unknownModel`), asked again while the chain is
   * paused on one so that the pause lifts once the model is fixed (BTN-679). Absent — such a pause waits for Resume.
   */
  modelBlock?: (project: string, task: string) => Promise<Notice | undefined>
  busy: (task: string) => boolean
  silentSince?: (task: string) => string | null
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
  /**
   * Moves the task to the status its source chose for its start or its pull request (BTN-554), only forward; never
   * throws, a refusal is the page's to show. Absent — no moves.
   */
  moveStatus?: (project: string, task: string, when: MoveWhen) => Promise<void>
  now: () => Date
  limited: (task: string) => LimitedSession | undefined
  /** Fresh paid-usage or exhausted-allowance evidence for this working session. */
  overage?: (task: string) => OverageSession | undefined
  handoff: (task: string) => HandoffSession | undefined
  locate: (session: HandoffSession) => Promise<HandoffSession>
  /** The account a new session of the project (or of `task`) would start on. */
  account: (project: string, task?: string) => AccountNow
  accountAt: (account: string, at: string) => string | null
  /** When the spent limit of the account the project's session (or `task`'s) would start on resets; `null` — not spent. */
  limitReset: (project: string, task?: string) => string | null
  /**
   * The model's own week used up on the account the project's session (or `task`'s) would start on (BTN-816): the chain
   * holds the task until the week opens. `null` — no such week.
   */
  modelWeek?: (project: string, task?: string) => ModelWeekHold | null
  /** When the limit hit at `at` resets; a key's recovery may precede the spending reset in `text`. */
  limitResetAfter: (account: string, at: string, text?: string) => string | null
  /**
   * When a poll after the limit hit at `at` showed the account open before `resetsAt` for the model `task` runs on now
   * (BTN-530); `null` — it did not.
   */
  limitReopenedAt: (account: string, at: string, resetsAt: string, project: string, task: string) => string | null
  /**
   * The account the project's session (or `task`'s) would start on has not answered its first limits poll since the
   * service started: until then a spent limit looks like no limit at all (BTN-595). `undefined` — it has answered.
   */
  limitsUnread: (project: string, task?: string) => LimitsWait | undefined
  /**
   * The project's set of packages has a problem that holds its sessions (BTN-174): installing, no answer yet, or the
   * gateway down. The chain waits and the page says so (BTN-657).
   */
  packagesBlocked: (project: string) => boolean
  /**
   * A package of the set needs the user: not installed, failed to install or lacks a key (`chain.packagesNotReady`,
   * BTN-657). The chain pauses on it, except for a fix session of a red main, and goes on by itself once it is fixed.
   */
  packagesPause: (project: string) => Notice | undefined
  /**
   * `brief` is off and no package of the project brings its tracker's MCP server (`chain.noTrackerMcp`, BTN-656): a
   * session would not see its task. The chain pauses on it and goes on by itself once it is gone.
   */
  trackerBlock: (project: string) => Notice | undefined
  /**
   * Why a user's Start does not go by the project's last task list (BTN-830): its profile is turned off, or the list was
   * read before its tracker last answered again. Start reads the tracker anew first and refuses if the reason stays.
   */
  listBlock?: (project: string) => Notice | undefined
  /**
   * The service has read its account folders once since its start. Until then every folder looks gone, so the chains
   * do nothing rather than pause on it; the first read checks them again.
   */
  accountsRead: () => boolean
  /**
   * The monitor has read the sessions once since the service's start. Until then `busy`, `liveSession` and the
   * sessions a cleanup stops know nothing, so the chains do nothing rather than take a working session for a free one (BTN-646).
   */
  sessionsRead: () => boolean
  /** The language of the prompts of the task's project. */
  promptLanguage: (task: string) => Language
  /** The main branch of the task's project, which the prompts name. */
  mainBranch: (task: string) => string
  /** Whether the task's project is in PR mode, which the prompts name; absent — it is not. */
  pullRequests?: (task: string) => boolean
  /**
   * Whether the task's project has no git (BTN-883): its folder is shared by its tasks, the prompts name no branch or
   * merge, and the mark at a turn's end closes the task with the session's last message as the comment. Absent — it has.
   */
  plain?: (task: string) => boolean
  resume:(task: string, session: LimitedSession) => Promise<string>
  /** Stops the waiting session and resumes it with the user's reply; returns the session id it came up under. */
  reply: (task: string, session: HandoffSession, prompt: string) => Promise<string>
  relay: (task: string, session: HandoffSession, prompt: string, reason: HandoffReason) => Promise<string>
  /** Starts the session that fixes a red main without a task, in a place of its own; `report` says what broke, `reran` — see `SessionFix`. */
  launchFix: (project: string, name: string, report: string, reran?: boolean) => Promise<string>
  /** Starts the session that resolves a release project's carry (BTN-369) in a place of its own; `report` says what conflicted. */
  launchCarry: (project: string, name: string, report: string) => Promise<string>
  /** Whether the project's main branch has the commit: the carry's release commit is in. */
  carried: (project: string, commit: string) => Promise<boolean>
  /** Stops a session, mid-turn too: a red main or detected subscription overage (invariant 1). */
  stop: (session: HandoffSession) => Promise<void>
  /** Cleans up after the task; `pull` — after a task whose pull request was closed. */
  finish: (project: string, task: string, pull?: PullCleanup) => Promise<FinishOutcome>
  /** Syncs the project's main the way the cleanup does (`syncMain`): the next try of a sync that could not reach a remote. */
  sync: (project: string) => Promise<Notice | null>
  /** Reads the project's tasks from its tracker anew and hands them over (`setTasks`); resolves once done or failed. */
  refresh: (project: string) => Promise<void>
  log: (message: string) => void
  /** Without it the chain neither waits for the CI after a push of main nor reacts to a red one. */
  main?: MainCheckDeps
  /** Without it no project is in PR mode. */
  reviews?: ReviewDeps
  /** Without it a `NO CHANGES:` mark closes nothing. */
  unchanged?: UnchangedDeps
}

export interface MainCheckDeps {
  /** The other projects guarding the same main of the same remote (BTN-217): a red main of one is red for all. */
  peers: (project: string) => string[]
  /** The commit main is at in the project's checkout; `null` — unknown. */
  head: (project: string) => Promise<string | null>
  /** What the project's counted CIs say of a commit pushed at `since`. */
  verdict: (project: string, commit: string, since: string) => CiVerdict
  /** The project's counted CIs are asked again for a while, though no run is under way: a rerun may change a verdict (EKR-88). */
  lookAgain: (project: string) => void
  /** `ci.rerunFailed` (BTN-846): the first red verdict on a commit reruns its failed jobs before anything is fixed. */
  rerunFailed: (project: string) => boolean
  /** Reruns the failed jobs of each run; throws why one was not rerun (`ci.rerunUnsupported`, `ci.rerunDenied`, …). */
  rerun: (project: string, failed: RedRun[]) => Promise<void>
  /** Writes an entry of the event log. */
  event: (draft: EventDraft) => void
  /** The remote's main by project, where the project's counted CIs have read it and agree on it (BTN-707). */
  remoteHeads: () => Record<string, string>
  /** How long the next launch waits for the verdict: `null` — as long as it takes, `0` — not at all. */
  waitMs: (project: string) => number | null
  /** `greens` — the last green commits of the project and of its peers (BTN-702): a commit behind any of them is no suspect. */
  report: (project: string, push: MainPush, failure: MainFailure, greens: string[]) => Promise<RedReport>
  /** Creates a task in the project's tracker ready for the chain; `null` — the tracker cannot create tasks. */
  create: (project: string, task: Omit<NewTask, 'project'>) => Promise<string | null>
  comment: (task: string, body: string) => Promise<void>
  /** Prepares the place of the next task while the chain waits; its launch then reuses it. */
  prepare: (project: string, task: string) => Promise<void>
  /** The tree the check before the task's merge reported it passed on, with the project's commands now; `null` — no such report. */
  reportedTree: (project: string, task: string) => string | null
  tree: (project: string, commit: string) => Promise<string | null>
  /** The project's check (BTN-104): no commands — none; `recheck` — run it on main when main is not what it ran on. */
  checking: (project: string) => { commands: string[]; recheck: boolean }
  /** Runs the project's check on main in the place of the task about to start, which keeps it for the launch. */
  checkMain: (project: string, task: string, commit: string) => Promise<MainCheckRun>
  /** `ci.fixTask`: a red main becomes a task in the tracker rather than a session without one. */
  fixTask: (project: string) => boolean
  /** The name the project's fix session runs under: `ABC-FIX`. */
  fixName: (project: string) => string
  /** Whether the branch of the task, or of the fix session, is in main with commits of its own. */
  merged: (project: string, task: string) => Promise<boolean>
  /** Whether the project has `commands.afterGreen` (BTN-156). */
  afterGreen: (project: string) => boolean
  /** Runs them in the project's checkout, if it is on main at `commit`. */
  runAfterGreen: (project: string, commit: string) => Promise<AfterGreenRun>
}

/** `skipped` — the guard kept the checkout untouched, or the run could not start. */
export type AfterGreenRun = { state: 'done' } | { state: 'failed'; failure: CheckFailure } | { state: 'skipped'; reason: Notice }

/** How a run of `commands.afterGreen` ended (BTN-829): the failed command's output stays in the log. */
export type AfterGreenEnd = { at: string } & ({ state: 'done' } | { state: 'failed'; command: string; code: number } | { state: 'skipped'; reason: Notice })

/** The last run of the project's `commands.afterGreen` (BTN-829); no `end` — still going, or the service stopped before it ended. */
export interface AfterGreenRecord {
  commit: string
  since: string
  end?: AfterGreenEnd
}

/** Who pushed a commit of main, as the service saw it (BTN-829): the chain after a task, or a person by hand (BTN-707). */
export type PushBy = 'chain' | 'hand'

/**
 * What the chain knows of the project's main for the CI panel (BTN-829). The late watch and who pushed are kept in
 * memory only, so a restart forgets them as it ends their effect.
 */
export interface MainCiView {
  /** The chain is still judging this push, including the request and wait for a rerun; its raw CI red is not final. */
  judging?: string
  /** A push no runner took in time that a run taken later still judges (BTN-719), and until when. */
  late?: { commit: string; until: string }
  /** Only for a project with `commands.afterGreen`; `running` — the run is going on now. */
  afterGreen?: AfterGreenRecord & { running: boolean }
  /** The latest pushes of main the service saw, by commit. */
  pushes: Record<string, PushBy>
}

/** The first command of the project's check that failed, with its output. */
export interface CheckFailure {
  command: string
  code: number
  output: string
}

export type MainCheckRun = { state: 'green' } | { state: 'red'; failure: CheckFailure } | { state: 'skipped'; reason: string }

/** What found main red: the CI's failed runs or the project's own check. */
/** `reran` — Even Keel reran the failed jobs once and they failed again (BTN-846). */
export type MainFailure = { ci: RedRun[]; reran?: true } | { check: CheckFailure }

/** The fix task's title and description, the comment for a fix task already open, and the prompt of a fix session without a task. */
export interface RedReport {
  title: string
  description: string
  comment: string
  prompt: string
}

export function emptyChainState(): ChainState {
  return { active: [], queue: [], orders: {}, skipped: {}, leftovers: {}, released: {}, shelved: {}, unattended: false, trimTools: true, ci: {}, reviews: {} }
}

export function newChain(project: string): ActiveChain {
  return { project, current: null, paused: false, error: null }
}
