import type { CloudConnection } from './account/cloud.js'
import type { EditChoice } from './account/settingsLayer.js'
import type { ModelList } from './agent/contract.js'
import type { BadgeCheck } from './badge/check.js'
import type { BadgeSettings } from './badge/model.js'
import type { BuiltinControl } from './builtin/control.js'
import type { CheckReport } from './chain/checkreports.js'
import type { StatusMoves } from './chain/moves.js'
import type { ChainRules } from './chain/rules.js'
import type { EventHub } from './events.js'
import type { GuardSettings } from './guard.js'
import type { HotkeyBindings } from './hotkeys.js'
import type { Language } from './language.js'
import type { NoticeKind } from './notice/kinds.js'
import type { ProfilesControl } from './profiles/routes.js'
import type { RepoBranches } from './projects/branch.js'
import type { ApprovalDecision } from './sessions/approvals.js'
import type { MailEvent } from './sessions/mail.js'
import type { HookMail } from './sessions/mailRelay.js'
import type { ChangelogOp, ChangelogView, FeedDraft, ProjectCheck, ProjectDraft, ProjectForm, ProjectTrust, SharedForm, Standard } from './state.js'
import type { Calibration } from './stats/calibration.js'
import type { CheckpointThreshold, SessionCheckpoint } from './stats/checkpoint.js'
import type { TallyServerDraft } from './stats/connect.js'
import type { TallyMode } from './stats/mode.js'
import type { AccountSpend, AccountTokens, PeriodQuery, StatsAnswer, StatsFilter, StatsHistory, StatsPeriod, StatsTaskDetail } from './stats/model.js'
import type { CompareQuery, RuleDiffFile, RulesQuery, StatsCompare, StatsRules } from './stats/rules.js'
import type { StatsSteps } from './stats/steps.js'
import type { TaskCard } from './tracker/card.js'
import type { LabelChange } from './tracker/labels.js'
import type { TaskStatus } from './tracker/model.js'
import type { TaskFile, TrackerVocabulary } from './tracker/source.js'

export interface StatsSource {
  history(filter: StatsFilter): Promise<StatsAnswer<StatsHistory>>
  period(query: PeriodQuery): Promise<StatsAnswer<StatsPeriod>>
  steps(query: PeriodQuery): Promise<StatsAnswer<StatsSteps>>
  task(task: string): Promise<StatsAnswer<StatsTaskDetail>>
  calibration(project: string, task: string | null): Promise<StatsAnswer<Calibration>>
  checkpoints(): Promise<StatsAnswer<CheckpointThreshold[]>>
  spend(tz: string): Promise<StatsAnswer<Record<string, AccountSpend>>>
  tokens(tz: string): Promise<StatsAnswer<Record<string, AccountTokens>>>
  rules(query: RulesQuery): Promise<StatsAnswer<StatsRules>>
  ruleDiff(ids: string[]): Promise<StatsAnswer<RuleDiffFile[]>>
  compare(query: CompareQuery): Promise<StatsAnswer<StatsCompare>>
}

export interface ChainControl {
  start(project: string): Promise<void>
  resume(project: string): void
  stop(project: string): void
  /** "Stop after this task": on — the chain stops once its current task is done and cleaned up instead of taking the next. */
  stopAfter(project: string, on: boolean): void
  dequeue(project: string): void
  reorder(project: string, order: string[]): void
  requeue(order: string[]): void
  skip(project: string, task: string): void
  unskip(project: string, task: string): void
  restart(project: string, task: string, confirmed?: import('./sessions/silence.js').SilentRestart): void
  dismiss(project: string, task: string): void
  /** "Accept as answer" (BTN-885): the last message of the task's session `sessionId` goes on it as a comment, the task to Done. */
  accept(project: string, task: string, sessionId: string): Promise<void>
  setUnattended(on: boolean): void
  setTrimTools(on: boolean): void
}

export interface AccountControl {
  discoverGlobal(agent: string): Promise<void>
  useGlobal(agent: string): Promise<void>
  /** `method` — the agent's way to sign in, for an agent with several (`Agent.login`). */
  add(agent: string, method?: string): void
  /** An account of the agent paying from a key: Anthropic's for Claude, OpenAI's for Codex, either for OpenCode. */
  addApiKey(name: string, key: string, agent: string, provider?: string): Promise<void>
  /** A Claude account on a cloud, checked by one short turn before it is kept (BTN-822). */
  addCloud(name: string, connection: CloudConnection): Promise<void>
  /** The AWS profiles of the service's user into `AccountView.aws`, for the cloud form. */
  readAws(): void
  /** The Google Cloud credentials of the service's user into `AccountView.gcloud`, for the Vertex form (BTN-823). */
  readGcloud(): void
  /** The Azure sign-in of the service's user into `AccountView.azure`, for the Foundry form (BTN-824). */
  readAzure(): void
  /** A new key in the folder of an API account, its name, roles and pools kept (BTN-418). */
  replaceApiKey(account: string, key: string): Promise<void>
  /** An OpenRouter account's management key for its balance, checked first; null removes it (BTN-868). */
  setManagementKey(account: string, key: string | null): Promise<void>
  renew(account: string): void
  switchTo(account: string): void
  switchApp(app: string, account: string): Promise<void>
  remove(account: string): Promise<void>
  keep(account: string): void
  /** The name the page shows for the account; blank — its default. */
  rename(account: string, name: string): void
  /** A key changed right in a Claude folder's `settings.json` (BTN-901): made shared, kept as the account's own, or dropped. */
  resolveSettingsEdit(account: string, key: string, choice: EditChoice): Promise<void>
  /** A key of the account's own settings layer goes; the global value comes back. */
  dropOwnSetting(account: string, key: string): Promise<void>
  code(code: string): void
  cancel(): void
}

export interface TaskControl {
  /** `undefined` — no connected tracker gives a card for the task. */
  card(task: string): Promise<TaskCard | undefined>
  /** `undefined` — no connected tracker gives the file, or the task has no such file. */
  file(task: string, file: string): Promise<TaskFile | undefined>
  /** "Into the chain": puts the missing required label on and moves the task out of the backlog status. */
  ready(task: string): Promise<void>
  /** "To the backlog": the mirror of `ready`, refused for a task with a live session. */
  unready(task: string): Promise<void>
  relabel(task: string, change: LabelChange): Promise<void>
  /** `milestone` is an id from the card's `milestones`; `null` — out of any. */
  moveMilestone(task: string, milestone: string | null): Promise<void>
  /** Reads the project's tasks from its tracker now, out of turn. */
  refresh(project: string): Promise<void>
}

export interface AnswerRequest {
  project: string
  task: string
  sessionId: string
  /** The id of the `AskUserQuestion` answered; `null` — a reply to a turn that ended in plain text. */
  ask: string | null
  answers: Record<string, string>
  text: string
  files: { name: string; data: Uint8Array }[]
  /** "New session with this message": the reply starts a new session with the handoff instead of resuming (BTN-757). */
  renew: boolean
}

export interface SessionControl {
  answer(request: AnswerRequest): Promise<void>
  /** The chat's "Dismiss": the session's returned messages leave the chat window. */
  dismissMail(sessionId: string): void
}

export interface SettingsControl {
  /** Writes into the config file the project's settings that differ from `base`, the values the form started from. */
  save(project: string, form: ProjectForm, base: ProjectForm): void | Promise<void>
  /** Writes into the config file the shared settings that differ from `base`. */
  saveShared(form: SharedForm, base: SharedForm): void
  /**
   * What the wizard's draft comes to: the repository, the config with it, the tracker's answer, Claude Code's trust;
   * `tracker: false` — the page holds the tracker's answer, the tracker is not asked (BTN-737).
   */
  check(draft: ProjectDraft, options: { tracker: boolean }): Promise<ProjectCheck>
  /** Claude Code's trust in the project's checkout as the Claude account folder `account` (blank — the project's own) sees it. */
  trust(project: string, account: string | null): Promise<ProjectTrust>
  /** The main checkout's branches for the main branch field; reading them notes a checkout moved by hand (BTN-754). */
  branches(project: string): Promise<RepoBranches>
  /** "Make it the main branch": the checkout's branch becomes the project's, git is not touched. */
  adoptBranch(project: string): Promise<void>
  /** "Put the folder back": the main checkout goes onto the project's branch. */
  restoreBranch(project: string): Promise<void>
  /**
   * Starts the job that creates the wizard's project (BTN-1048): the folder, the clone or the first commit, the entry on
   * its main branch, the trust and the packages; the page follows it in `state.jobs`. A draft the check refuses starts none.
   */
  add(draft: ProjectDraft): void | Promise<void>
  /** Drops the project from the config; refuses while its chain, sessions or places still hold it. */
  remove(project: string): void
  /**
   * Turns git on for a project without git (BTN-884), only between its tasks; there is no way back (BTN-1063). The folder
   * made a repository on the project's branch, `slot` — how many slots its tasks take, 0 — a worktree each; work done in
   * a repository while git was off goes into one commit with `commit`, or refuses the switch (BTN-1054). `branch` — the
   * project's main branch becomes this one first: the branch of a repository its agent made (BTN-1025).
   */
  turnGitOn(project: string, options: { slot: number; commit: boolean; branch?: string }): Promise<void>
  /** What turning git on would commit as work done without git: `git status --porcelain` lines, none for a fresh repository. */
  gitChanges(project: string): Promise<{ files: string[] }>
  /** Adds an extra task feed to the project (BTN-66); refuses one the config would not parse. */
  addFeed(project: string, draft: FeedDraft): void
  /** Drops the project's feed; the archive keeps the closed tasks it gave. */
  removeFeed(project: string, feed: string): void
  /** `null` — the feed reads on its tracker's default profile; refused once the chain has started its tasks. */
  linkFeed(project: string, feed: string, profile: string | null): void
  /** The feed's own chain rule keys (BTN-553), all of them at once; refuses ones that clash with its profile's. */
  feedRules(project: string, feed: string, rules: Partial<ChainRules>): void
  /** A tracker profile's status moves (BTN-554), all at once; refuses a status its rules would not take. */
  profileMoves(id: string, moves: StatusMoves): Promise<void>
  /** A task source's own status moves: the project's main tracker with `feed` null, else the feed; checked the same way. */
  sourceMoves(project: string, feed: string | null, moves: StatusMoves): Promise<void>
  /** The project's own milestone order by label (BTN-792), all of it at once; an empty list goes back to the automatic order. */
  milestoneOrder(project: string, labels: string[]): void
  /** The project's README badge (BTN-917), all of it at once; `null` — none. Refuses a bad address or name. */
  badge(project: string, badge: BadgeSettings | null): void
  /** The badge dialog's "Check" of a Worker's address and name with the push secret: a push, then a read of the picture. */
  checkBadge(project: string, url: string, slug: string): Promise<BadgeCheck>
  /** The toast's "Close": no toast for this version, a later one shows it again. */
  dismissUpdate(version: string): void
  /** A banner's "Got it" (BTN-759): its ids with the stamps of what they said; one comes back once its stamp changes. */
  dismissNotices(entries: Record<string, string>): void
  /** The hotkeys window (BTN-880): the browser's whole layout at once, only what differs from the defaults; empty — the defaults. */
  saveHotkeys(browser: string, bindings: HotkeyBindings): void
  /** "Don't show again" and the "Notices" switches: one kind, `project` `null` for Even Keel's; `shown` `null` — back to Even Keel's. */
  muteNotice(project: string | null, kind: NoticeKind, shown: boolean | null): void
  /** The toast's "Don't show again": no toasts about new versions until the switch on /settings. */
  muteUpdates(): void
  /** The update window's "Update" to the latest release (BTN-163): waits for the chains, then the update process takes over. */
  installUpdate(): Promise<void>
  /** Its "Revert" to the version the last update came from. */
  revertUpdate(): Promise<void>
  /** "Close" on how the last update or revert ended. */
  closeUpdateResult(): void
}

/** The page's commands on packages (`src/packages/service.ts`); a project is named by its key. */
export interface PackagesControl {
  install(name: string): Promise<void>
  update(name: string): Promise<void>
  remove(name: string): void
  addMarketplace(): Promise<void>
  addPlugin(plugin: string, marketplace: string, project?: string): void
  addServer(name: string, entry: Record<string, unknown>, project?: string): void
  wrapSkills(names: string[], project?: string): Promise<void>
  importRepo(project: string): void
  choose(project: string, name: string, choice: 'on' | 'off' | null): void
  setDefault(name: string, on: boolean): void
  setSetting(name: string, key: string, value: string | null, project?: string): void
  setKey(name: string, value: string): void
}

/** The `.env` credentials the page writes (`src/secrets/`): the page token alone, the stats classifier's together. */
export interface SecretsControl {
  set(name: string, value: string): void
  remove(name: string): void
  /** `null` removes the variable. */
  update(values: Record<string, string | null>): void
}

/** Where Tally writes (BTN-247): the page's stats setup and the stats settings. */
export interface TallyControl {
  /** `server` checks the connection first; `null` fields — the ones `.env` has. */
  set(mode: TallyMode, server: TallyServerDraft | null): Promise<void>
}

export interface ServerDeps {
  cli?: { download(agent: string): void; system(agent: string): void; checked(agent: string): void; check(): Promise<void> }
  /** The Huly client installed on demand (BTN-666): "Retry" after a failed install. */
  hulyClient?: { install(): void }
  /** The first run's Git step and the wizard's "Make it a repository" (BTN-731). */
  git?: { check(): Promise<void>; identity(name: string, email: string): Promise<void>; init(repo: string, branch: string): Promise<void> }
  /** The windows of step jobs (BTN-1048): "Retry" of a failed step, "Cancel", closing a finished one. */
  jobs?: { retry(id: string): void; cancel(id: string): Promise<void>; close(id: string): void }
  /** The demo on the first run (BTN-776): its project goes into the state's `demo`. */
  demo?: { start(language?: Language): Promise<unknown>; again(language?: Language): Promise<unknown>; remove(): Promise<void> }
  hub: EventHub
  publicDir: string
  getState: () => unknown
  getTray: () => { language: Language | null; asking: number; paused: number }
  control: ChainControl
  account: AccountControl
  sessions: SessionControl
  settings: SettingsControl
  packages: PackagesControl
  secrets: SecretsControl
  tally: TallyControl
  profiles: ProfilesControl
  /** The page's commands on the built-in tracker's tasks (BTN-767); without it they are refused. */
  builtin?: BuiltinControl
  launches: () => unknown
  sessionRecord: (sessionId: string) => Promise<unknown>
  /** Lines of the whole transcript from index `after` on, and its last turn. */
  transcript: (sessionId: string, after: number) => Promise<unknown>
  /** Picture `index` of the result of call `tool` in the session's transcript; `undefined` — none. */
  transcriptImage: (sessionId: string, tool: string, index: number) => Promise<TaskFile | undefined>
  /** A file the user sent the session, by its name; `undefined` — the transcript names no such file or it is gone. */
  inboxFile: (sessionId: string, name: string) => Promise<TaskFile | undefined>
  /** File `index` the session sent the user by call `tool` (`SendUserFile`); `undefined` — no such file, outside its folders, or gone. */
  sharedFile: (sessionId: string, tool: string, index: number) => Promise<TaskFile | undefined>
  /** For the agent-bridge hook; `undefined` for a session the chain did not start. */
  checkpoint: (sessionId: string) => Promise<SessionCheckpoint | undefined>
  /** For the checkpoint mark hook: the note the turn wrote near its end (`noteWritten`), `null` — none; `undefined` as above. */
  handoffNote: (sessionId: string) => Promise<string | null | undefined>
  /**
   * For the merge hook: the project's check commands to run before the merge, empty — none, its main branch and its
   * standards (BTN-359), which the standards hook reads too; `undefined` for a session the chain did not start.
   */
  /** `git: false` — a project without git: the `agent-bridge` hook refuses its sessions' calls of git (BTN-1052). */
  mergeCheck: (sessionId: string) => { commands: string[]; branch: string; standards: Standard[]; git?: false } | undefined
  /** For the merge hook: the check before the merge passed on a tree (EKR-103); `false` for a session the chain did not start. */
  checkReport: (sessionId: string, report: CheckReport) => boolean
  /**
   * For the mailbox hook: reserves the chat's messages until the response finishes, as one text;
   * `null` — none wait, or the task is over (BTN-558); `undefined` for a session the chain did not start (BTN-181).
   */
  mail: (sessionId: string, event: MailEvent) => Promise<HookMail | null> | undefined
  /**
   * What else the mailbox hook puts into the context at a tool call, asked only for a session `mail` knows: the
   * request for the README badge's status line (BTN-932); `null` — nothing.
   */
  mailContext?: (sessionId: string, event: MailEvent) => string | null
  /**
   * For the permission hook started at `since` (ms): the user's decision on the tool call the session waits to have
   * approved; `null` — not yet; `undefined` for a session the chain did not start, or a call whose dialog is gone (BTN-269).
   */
  permission: (sessionId: string, tool: string, input: Record<string, unknown>, since: number) => ApprovalDecision | null | undefined
  /** `undefined` for a project the config does not know. */
  tools: (project: string) => Promise<unknown>
  /** By the project's id; `undefined` when the config does not know it or its tracker is off or names nothing. */
  vocabulary: (projectId: string) => Promise<TrackerVocabulary | undefined>
  /** The statuses of a tracker profile (BTN-554); `undefined` — no such profile, its kind moves none, or the tracker named none. */
  profileStatuses: (id: string) => Promise<TaskStatus[] | undefined>
  /** The models of the account folder `key` for the model fields (`Agent.models`); `null` — none known. */
  models: (key: string) => Promise<ModelList | null>
  tasks: TaskControl
  /** An operation on the milestone's changelog draft; its newest version (`src/changelog/drafts.ts`). */
  changelog: (project: string, milestone: string, op: ChangelogOp) => Promise<ChangelogView>
  /** "Carry now": the release project's branch into the branch of the project it merges into (BTN-172). */
  carry: (project: string) => Promise<void>
  /** "Resolve with the agent": a session resolves the release project's held conflict (BTN-369). */
  resolveCarry: (project: string) => Promise<void>
  stats: StatsSource
  /** The project's README badge as SVG, for the page's preview (BTN-915), `still` for its PNG (BTN-920); `undefined` — no such project. */
  badge?: (project: string, theme: 'dark' | 'light', still: boolean) => string | undefined
  /** Read per request: `allowedHosts` is live. */
  guard: () => GuardSettings
}


