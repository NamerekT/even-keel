import type { Standard, ProjectSettings, OwnKey, OwnValues, CiSettings, CacheTtl, ContextScale, StatsConfig, CheckpointShares, ProjectForm, SharedForm } from './state/settings.js'
export type { Standard, ProjectSettings, OwnKey, OwnValues, CiSettings, CacheTtl, ContextScale, StatsConfig, CheckpointShares, ProjectForm, SharedForm } from './state/settings.js'
import type { AccountView } from './account/model.js'
import type { BadgeStatus } from './badge/status.js'
import type { ActiveChain, Leftover, ProjectOrder } from './chain/dispatcher.js'
import type { FixEpisode, LaunchDay, TaskSession } from './chain/launches.js'
import type { MainCiView } from './chain/model.js'
import type { StatusMoves } from './chain/moves.js'
import type { ChainRules } from './chain/rules.js'
import type { CiView } from './ci/model.js'
import type { Language } from './language.js'
import type { RateLimits } from './limits/model.js'
import type { UsageHealth } from './limits/usage.js'
import type { Notice } from './notice/notice.js'
import type { BackgroundWait, Lamp } from './sessions/agents.js'
import type { Ask } from './sessions/ask.js'
import type { SessionMail } from './sessions/mail.js'
import type { SecretPlace, SecretReaders } from './secrets/catalog.js'
import type { TallyHealth, TallyMode } from './stats/mode.js'
import type { RemoteOff } from './sessions/remote.js'
import type { ApiErrorKind, CacheWindow, FeedLine, Stage, TokenTotals } from './sessions/transcript.js'
import type { TrackerView } from './tracker/health.js'
import type { Task } from './tracker/model.js'
import type { UpdatesView } from './updates/release.js'

export interface SessionView {
  task: string
  sessionId: string
  /** The agent the session runs on (`src/agent/adapters.ts`). */
  agent: string
  /** The model of its last answer, from the transcript; `null` — it has not answered yet. */
  model: string | null
  cwd: string
  /** The git branch of the session's last line, for the head of the chat window. */
  branch: string | null
  lamp: Lamp
  /** The last line of the session's last response is `CHECKPOINT: <path>`: it waits to be handed over, not for an answer. */
  checkpoint: boolean
  waitingFor: string | null
  /** What the CLI dialog the session hangs on before its first turn asks for: not mid-turn, nobody in the background answers it. */
  startupDialog: string | null
  /** Since when its live turn has written nothing and is taken for hung (`AgentEntry.hungSince`); answering or "New session" ends it. */
  hungSince: string | null
  /** Last write of a live working turn; shared by the countdown and the confirmed early restart. */
  silentSince?: string | null
  /** Its turn has ended and it waits for its own background command, the lamp still `working`; absent or `null` — it does not. */
  background?: BackgroundWait | null
  /** The session waits on an `AskUserQuestion` the user has not answered. */
  asking: boolean
  /** That `AskUserQuestion`, for the answer panel of the chat window: from the transcript, or from the job file while the CLI has not written it there. */
  ask: Ask | null
  apiError: string | null
  apiErrorKind: ApiErrorKind | null
  apiErrorNotice?: Notice
  startedAt: string
  lastActivityAt: string | null
  contextTokens: number
  /** The model's context window, from the transcript or the agent's own answer; `null` — unknown, the page uses `ContextScale.window`. */
  contextWindow: number | null
  cache: CacheWindow | null
  tokens: TokenTotals
  stage: Stage | null
  action: FeedLine | null
  feed: FeedLine[]
  /** The session's own status line for the README badge (`TranscriptSummary.badgeStatus`); absent — its agent writes none. */
  badgeStatus?: BadgeStatus | null
  remoteUrl: string | null
  remoteOff: RemoteOff | null
  account: string | null
}

export interface SessionRecord {
  sessionId: string
  startedAt: string | null
  lastActivityAt: string | null
  contextTokens: number
  /** The record's own window, falling back to the last window observed by the session monitor. */
  contextWindow: number | null
  tokens: TokenTotals
  stage: Stage | null
  feed: FeedLine[]
  workdir: string | null
  branch: string | null
  apiError: string | null
  apiErrorNotice?: Notice
  /** The e-mail of the account the session ran on. */
  account: string | null
}

/** Task link templates (`TrackerSetup.issueUrl`): `{id}` — the task id, `{number}` — its number. */
export interface TrackerUrls {
  default: string | null
  /** By the prefix of the task ids (`idPrefixOf`): projects with one prefix are on one tracker project. */
  projects: Record<string, string | null>
  /** The page of each project and each feed in its tracker (`TrackerSetup.projectUrl`), by the project's or the feed's id; `null` — none. */
  pages: Record<string, string | null>
}

/** A tracker the settings can pick, and the key a project on it names its tracker project with. */
export interface TrackerChoice {
  name: string
  /** The name on the page: `GitHub`, not `github`. */
  title: string
  /** `alias` — the value names the tracker's project in place of the key (Huly), see `TrackerProjectKey.alias`. */
  projectKey: { key: string; example: string; optional: boolean; alias: boolean } | null
}

export type { ProjectDraft, ProjectCheck, ProjectTrust } from './projects/state.js'
export type { BranchChoice, BranchDrift, BranchMove, RepoBranches } from './projects/branch.js'
import type { BranchDrift } from './projects/branch.js'

/** How a release project's branch goes into the branch of the project it merges into (`mergeInto`, BTN-172). */
export interface ForwardView {
  into: string
  /** The commits of the release branch the other branch lacks; `null` — not read yet. */
  behind: number | null
  /** Why they wait; `null` — nothing waits. */
  hold: Notice | null
  /** A conflict holds them until "Carry now", the agent's session or a merge by hand. */
  held: boolean
  /** The last carry: when, how many commits, and its push that failed. */
  last?: { at: string; commits: number; push: Notice | null }
  /** The session that resolves the held conflict or is about to (BTN-369), a session of the chain of `into`. */
  agent?: string
}

/** The config file as the settings show it: the saved values, all applied on the fly. */
export interface ConfigView {
  shared: SharedForm
  projects: Record<string, ProjectForm>
  trackers: TrackerChoice[]
  /** The projects' extra task feeds (BTN-66), by project; a project without any is left out. */
  feeds: Record<string, FeedView[]>
  /**
   * Projects and feeds the chain has started a task of: their tracker, tracker project and profile stay, since the ids of
   * their tasks would no longer reach their records. Another tracker's tasks come in as a feed.
   */
  trackerLocked: string[]
}

/** An extra task feed of a project (BTN-66): its own tracker, a key for the ids where the tracker has none, a place in it. */
export interface FeedView {
  id: string
  tracker: string
  key: string
  /** By the tracker's project key; none where the key names it. */
  place?: string
  /** The chain rule keys the feed sets itself (BTN-553), over its profile's and the shared ones; none — it sets none. */
  chain?: Partial<ChainRules>
  /** The status moves the feed sets itself (BTN-554), over its profile's; none — it sets none. */
  moves?: StatusMoves
  /** The prefix of the feed's task ids (`idPrefixOf`): a task of the project is the feed's by it; none — the feed's key. */
  prefix?: string
}

/** A feed the page adds: a new id is given by the service. */
export interface FeedDraft {
  tracker: string
  key: string
  place: string | null
  /** The profile it reads on; `null` — its tracker's default. */
  profile: string | null
}

/** A repository a checkout's remote points at. */
export interface RemoteRef {
  /** The same for every url of one repository: host and path in lower case, or a local remote's resolved path. */
  id: string
  /** What a group of its projects is titled with: `owner/repo`, or a local remote's folder name. */
  path: string
}

export type ProjectTask = Task & { project: string }

/** Work in a task's worktree or slot that no commit of the project's main branch holds (BTN-298). */
export interface TaskWork {
  path: string
  branch: string
  /** The files left out of a commit; those git ignores (`.temp/`) are not counted. */
  files: number
  /** The commits of the branch the main branch does not have. */
  ahead: number
}

/** Git on the service's machine as the first run's Git step checks it (BTN-731). */
export interface GitSetupView {
  /** The version `git --version` gives; `null` — git does not start from the service. */
  version: string | null
  /** The name and e-mail commits are made as, which sessions commit and merge with; `null` — unset. */
  name: string | null
  email: string | null
  /** Git does not start: the command that installs it with the package manager found on the service's machine (EKR-54); absent — none found. */
  install?: string
  /** Git does not start on Windows: how Even Keel was started, which says what makes it see a git installed since. */
  restart?: WindowsStart
}

/**
 * How Even Keel runs on Windows: the tray host and a Windows service read `PATH` anew when they restart node (EKR-57),
 * node in a terminal keeps that terminal's.
 */
export type WindowsStart = { by: 'tray' } | { by: 'service'; name: string } | { by: 'console' }

export interface EvenKeelState {
  protection?: Record<string, import('./ci/protection-model.js').RemoteProtection[]>
  startedAt: string
  /** The platform of the service's machine (`process.platform`): the page's example paths follow it (BTN-634). */
  platform: string
  /** The projects by their ids, as every map of a project here names them: two projects may share a key (BTN-271). */
  projects: string[]
  /** The key of each project; an old link of the page names a project by it. */
  projectKeys: Record<string, string>
  /** What the page shows each project by (`projectLabel`): its key, with its name where another project has the key. */
  projectLabels: Record<string, string>
  /** The prefix of each project's task ids (`idPrefixOf`): its key, or its tracker project's where that is another one. */
  taskPrefixes: Record<string, string>
  /** The demo on the first run (BTN-776); `null` — there is none. Its project is in `projects` like any. */
  demo: import('./demo/model.js').DemoView | null
  config: ConfigView
  /** The projects whose main checkout stood off their main branch when last read: the settings opened or the chain started (BTN-754). */
  branchDrift: Record<string, BranchDrift>
  chain: {
    active: ActiveChain[]
    /** How many chains run at once (`parallel` in the config). */
    parallel: number
    queue: string[]
    projects: Record<string, ProjectOrder>
    skipped: Record<string, string[]>
    leftovers: Record<string, Leftover[]>
  }
  /** The tasks of every project with its project: a task of a tracker project two projects share is here for each. */
  tasks: ProjectTask[]
  sessions: SessionView[]
  limits: RateLimits | null
  usage: UsageHealth
  account: AccountView
  trackers: TrackerView[]
  trackerUrls: TrackerUrls
  /** The CIs of each project that has any; a project without CI has no key. */
  ci: Record<string, CiView[]>
  /** What the chain knows of each project's main for the CI panel (BTN-829); a project without CI has no key. */
  mainCi: Record<string, MainCiView>
  /** The remotes of each project's checkout: Home groups the projects that share one (BTN-207). */
  remotes: Record<string, RemoteRef[]>
  /**
   * The other projects whose checkout is of the same repository (`sameRepository`, BTN-285): what "Merges into" offers.
   * A project not read yet has no key.
   */
  sameRepository: Record<string, string[]>
  /**
   * Whether each project's PR mode would have where to open pull requests, by the same remotes (EKR-7): `null` — it
   * would; else `review.noRemote`, `review.unsupportedHost` or `review.noToken`. A project not read yet has no key.
   */
  pullReadiness: Record<string, Notice | null>
  launches: LaunchDay[]
  /** The sessions of each task by its id; a fix of a red main by the id of its episode (`fixes`). */
  taskSessions: Record<string, TaskSession[]>
  /** The fixes of each project's red main, oldest first (BTN-153). */
  fixes: Record<string, FixEpisode[]>
  /** The work left in each project's task folders, by project and task; a task with nothing there has no key (BTN-298). */
  works: Record<string, Record<string, TaskWork>>
  context: ContextScale
  configError: Notice | null
  packages: PackagesView
  /** The credentials of the "Access" tab of /settings (BTN-131). */
  secrets: SecretsView
  /** The trackers' profiles of the same tab (BTN-200). */
  profiles: ProfilesView
  language: Language | null
  unattended: boolean
  trimTools: boolean
  /** Where Tally writes (BTN-247); `null` — not chosen yet: the page offers the stats setup before anything else. */
  tally: TallyMode | null
  /** The collector's last run, for `/status` (BTN-66). */
  tallyHealth: TallyHealth
  /** The Huly client's install into the data folder (BTN-666) while it runs or after it failed; `null` — none. */
  hulyClient?: Notice | null
  updates: UpdatesView
  /**
   * The page's "Got it" marks (BTN-759): a banner's id and the stamp of what it said when closed; it comes back once
   * the stamp changes. Kept in `service_state`, so every device sees them.
   */
  noticesDismissed?: Record<string, string>
  /**
   * The page's hotkeys of each browser that changed one (BTN-880), by the id it keeps in its `localStorage`; a browser
   * not here has the defaults. Every tab gets them all and picks its own.
   */
  hotkeys?: Record<string, import('./hotkeys.js').HotkeyBindings>
  /** The installed CLIs whose version is not the one Even Keel was last checked against (BTN-249): a banner each until closed. */
  cliVersions: CliVersionView[]
  cliCopies?: Record<string, import('./agent/cli-state.js').CliCopyView>
  /** Git on the service's machine; absent until its first read. */
  git?: GitSetupView
  /** The automatic CLI check of each agent (BTN-569): waiting, running or its last result; empty while the setting is off. */
  cliChecks: CliCheckView[]
  /** The last day's launches whose run label had no account in the pool, newest first: a toast each until dismissed. */
  fallbacks: FallbackLaunch[]
  /** The chat mailbox of each live session whose hooks ask for mail or that has messages to show, by session id (BTN-181). */
  mailbox: Record<string, SessionMail>
  /** The tasks the changelog written last accounts for, by project and milestone (BTN-209). */
  changelogs: Record<string, Record<string, string[]>>
  /** How each release project's branch goes into the project it merges into, by the release project (BTN-172). */
  forwards: Record<string, ForwardView>
  /** The event log, oldest first (BTN-350): the service writes it also while no page is open; the page's toasts are its new entries. */
  eventLog: import('./event-log/model.js').EventEntry[]
}

/**
 * A CLI whose version differs from the one Even Keel was last checked against (BTN-249, `src/agent/versions.ts`), or an
 * account's daemon on another version than the pin (BTN-250).
 */
export interface CliVersionView {
  /** The agent's name in `AGENTS`. */
  agent: string
  /** The account folder of a daemon; `null` — the installed CLI. */
  account: string | null
  /** The version the installed CLI or the daemon runs. */
  installed: string
  checked: string
  notice: Notice
}

/** One agent's automatic CLI check (`src/cli-check/scheduler.ts`). */
export interface CliCheckView {
  /** The agent's name in `AGENTS`. */
  agent: string
  /** When the check began waiting, began running or ended. */
  at: number
  notice: Notice
}

/** How a changelog version came: the first draft, "write again", the user's edit, the new tasks added. */
export type ChangelogKind = 'draft' | 'again' | 'edit' | 'add'

/** One version of a milestone's changelog draft (BTN-209): the history of the dialog, not a copy of the file. */
export interface ChangelogVersion {
  /** The project key. */
  project: string
  milestone: string
  /** From 1, per project and milestone. */
  number: number
  kind: ChangelogKind
  /** The section, Markdown. */
  text: string
  /** What the page shows the changes against; `null` — nothing, the whole text is new. */
  base: string | null
  /** The user's words of an edit. */
  instruction: string | null
  /** The ids of the tasks the version accounts for. */
  tasks: string[]
  /** How many of the milestone's tasks were open. */
  open: number
  /** ISO. */
  at: string
  /** When it was written to the file, by which commit (empty when the file already had the text). */
  written: { at: string; commit: string } | null
  /** What the agent's turn that wrote it cost; `null` — kept before the cost was. */
  spend: ChangelogSpend | null
}

/** What a turn of its own cost (`Agent.write`). */
export interface TurnSpend {
  /** The model that answered, as the agent names it; `null` — the agent does not say. */
  model: string | null
  tokens: TokenTotals
  /** In dollars at API prices, as the agent counts it; `null` — the agent counts none (Codex). */
  cost: number | null
  durationMs: number
}

/** A changelog turn's cost and the account folder whose limits or credit paid it. */
export interface ChangelogSpend extends TurnSpend {
  account: string
}

/** Every turn of a milestone's changelog versions together. */
export interface ChangelogSpent {
  turns: number
  /** Of the turns with a cost. */
  cost: number
  /** Turns whose agent counts no cost: only their tokens are in. */
  unpriced: number
  tokens: TokenTotals
}

/** What the page asks of the milestone's changelog draft (`src/changelog/drafts.ts`). */
export type ChangelogOp = { op: 'open' } | { op: 'draft' } | { op: 'again' } | { op: 'add' } | { op: 'edit'; instruction: string } | { op: 'write' }

/** A milestone's changelog draft as the page shows it: its newest version, or what a first draft would start from. */
export interface ChangelogView {
  /** The project key. */
  project: string
  milestone: string
  /** The changelog file, relative to the repository's root. */
  file: string
  /** The milestone's newest tag; `null` — not released. */
  released: string | null
  /** `null` — no draft yet: opening writes none, the user asks for it (`draft`). */
  version: ChangelogVersion | null
  /** Only without a version: the milestone's done and open tasks and the milestone's section the file has now. */
  start: ChangelogStart | null
  spent: ChangelogSpent
}

/** What a milestone's first draft would start from. */
export interface ChangelogStart {
  done: number
  open: number
  /** The section in the file, Markdown; `null` — the file has none. */
  section: string | null
}

export interface FallbackLaunch {
  at: string
  task: string
  /** `chain.noAccountFor`. */
  notice: Notice
}

/** The packages sessions get (`src/packages/`): the catalog, each project's set and its problems, the keys. */
export interface PackagesView {
  /** The MCP gateway could not listen: no session gets a server. */
  gateway: Notice | null
  packages: PackageView[]
  /** By project key. */
  projects: Record<string, ProjectPackages>
  keys: KeyView[]
  /** Plugins of Even Keel's own marketplace and of those Claude Code knows that are not in the catalog. */
  available: { plugin: string; marketplace: string }[]
  /**
   * Even Keel's own marketplace (the `.claude-plugin/marketplace.json` of its checkout): chain sessions get its plugins
   * without it, sessions started by hand only once Claude Code knows it (`known`); `null` when the checkout has none.
   */
  marketplace: { name: string; dir: string; known: boolean } | null
  /** By project key: the servers of the repository's committed `.mcp.json` that are not in the catalog. */
  imports: Record<string, string[]>
  /** The user's own skills the page wraps into one plugin package, `package` (BTN-339). */
  skills: { package: string; list: OwnSkillView[] }
}

/** A skill of `~/.claude/skills` or Codex's skills folder; `from` is `null` for a wrapped one whose folder is gone. */
export interface OwnSkillView {
  name: string
  from: string | null
  /** The package holds it now. */
  wrapped: boolean
}

export interface PackageView {
  name: string
  kind: 'plugin' | 'mcp'
  /** Has a current install; an MCP server outside npm has one without a version. */
  installed: boolean
  version: string | null
  /** A later version a plugin's marketplace holds than the install: what Update would bring. */
  latest: string | null
  /** When Claude Code last fetched the plugin's marketplace (ISO): `latest` is as of then. `null` for a folder marketplace and an MCP server. */
  fetched: string | null
  installing: boolean
  /** The last install or update failed. */
  error: Notice | null
  /** The outcome of the last update: `packages.upToDate` or `packages.updated`. */
  note: Notice | null
  default: boolean
  /** The values projects start from. */
  settings: Record<string, string>
  servers: string[]
  /** Skills, hooks, commands or agents: only Claude Code gets them. */
  extras: boolean
  /** Removed, still held by a running task. */
  removed: boolean
  /** Even Keel's own `checkpoint` (BTN-986): every project has it, with no switches and no removal. */
  builtIn: boolean
}

export interface ProjectPackages {
  /** By package name. */
  cells: Record<string, PackageCell>
  /** Problems of the set as a whole (`noTrackerMcp`). */
  problems: PackageProblem[]
  /** A problem holds the chain: it waits until the problem is gone. */
  blocked: boolean
  /**
   * The tracker's MCP server and whether a package of the set brings it, whatever `brief` is; `through` — only another
   * server brings its tasks: Even Keel's tasks server (BTN-882). `also` — Even Keel's tasks server serves the tracker,
   * the page's default choice (BTN-874); `both` — packages of the set bring both servers, two tool sets of one tracker.
   * `null` — the tracker has none.
   */
  tracker: { server: string; brought: boolean; through?: string; also?: string; both?: boolean } | null
}

export interface PackageCell {
  /** The project's own choice; `null` — the package's default. */
  choice: 'on' | 'off' | null
  enabled: boolean
  /** The project's values over the package's. */
  settings: Record<string, string>
  problems: PackageProblem[]
}

export type PackageProblem =
  | { kind: 'notInstalled' }
  | { kind: 'installing' }
  | { kind: 'installFailed'; notice: Notice }
  | { kind: 'noKey'; variables: string[] }
  | { kind: 'noResponse'; servers: string[] }
  /** A server's first probe has not answered yet. */
  | { kind: 'probing' }
  | { kind: 'noTrackerMcp'; server: string }
  /**
   * The project's agent does not read Claude Code plugins: their hooks stay out, and their skills too unless `skills`
   * (OpenCode takes the skills folders). Does not hold the chain.
   */
  | { kind: 'unsupported'; agent: string; skills?: boolean }

export interface SecretsView {
  variables: SecretView[]
  /** A removed key still reaches new sessions: the daemon of the global folder waits for its live sessions to end. */
  sessionsPending: boolean
}

/** A credential the page writes (`src/secrets/`); a secret's value never leaves the service. */
export interface SecretView {
  name: string
  secret: boolean
  places: SecretPlace[]
  readers: SecretReaders
  set: boolean
  /** The value of a variable that is not a secret; `null` for a secret or one not set. */
  value: string | null
  /** Set from outside `.env`: the page cannot change it. */
  outer: boolean
  /** What the global `settings.json` holds for a key that goes to the sessions too; `null` — it does not go there. */
  sessions: 'same' | 'other' | 'none' | null
  /** The page token while the service listens beyond loopback: it cannot be removed. */
  required: boolean
}

export interface ProfilesView {
  profiles: ProfileView[]
  /** Each tracker a profile can be made for, in the adapters' order, then each CI. */
  kinds: ProfileKindView[]
}

/** A tracker's or a CI's profile (`src/profiles/`); a secret's value never leaves the service. */
export interface ProfileView {
  /** `warning` — the grant is another person's than the tracker's credentials (`profiles.mcpOtherAccount`, BTN-590). */
  mcpOAuth?: { state: 'connected' | 'reconnect'; warning?: Notice }
  id: string
  kind: string
  name: string
  /** The kind's profile for the sessions started by hand, the GitHub Actions of other trackers' projects and new projects. */
  isDefault: boolean
  /** Turned off (BTN-830): the service reaches nothing of its host; its projects' chains do not start. */
  disabled: boolean
  /** The kind's variables, each with what the profile holds. */
  fields: ProfileField[]
  login: string | null
  expiresAt: string | null
  check: ProfileCheck
  /** The keys of the projects that run on it: while there are any, its host fields stay and it cannot be removed. */
  projects: string[]
  /** The remotes whose CI takes its token and shows: what a CI's profile (Forgejo) is used by. */
  ci: CiRemote[]
  /** The remotes whose CI takes its token but is not shown: the token does not reach the repository or its runs. */
  hiddenCi: CiRemote[]
  /** The remotes whose forge refused to open a pull request with its token (`review.denied`, EKR-9). */
  deniedPulls: CiRemote[]
  /** A tracker's: the chain rules it sets for its projects (BTN-66), only the keys set. */
  rules: Partial<Pick<ChainRules, 'active' | 'terminal' | 'requiredLabels' | 'excludedLabels'>>
  /** A tracker's whose kind moves statuses: the statuses it moves its projects' tasks into (BTN-554), only the keys set. */
  moves: StatusMoves
  /** A tracker's: the ids of the projects that run on it or have a feed on it, for the rules' suggestions. */
  projectIds: string[]
}

export interface ProfileField {
  name: string
  secret: boolean
  set: boolean
  /** The value of a field that is not a secret; `null` for a secret or one not set. */
  value: string | null
}

export interface ProfileCheck {
  state: 'unchecked' | 'checking' | 'ok' | 'refused' | 'unreachable'
  /** Why it is not `ok`. */
  error: Notice | null
  at: string | null
}

/** What `profiles/check` answers: the values sign in. */
export interface CheckResult {
  login: string
  /** The name to offer. */
  name: string
  expiresAt: string | null
  /** The name of a profile already signed in as the same account on the same host. */
  duplicate: string | null
  /** The MCP grant is another person's than the tracker's credentials: a warning, saving goes on (BTN-590). */
  mcpWarning?: Notice
}

/** A project's remote with a CI. */
export interface CiRemote {
  project: string
  remote: string
}

export interface ProfileKindView {
  mcpOAuth?: boolean
  /** Sessions reach the kind's MCP server with the tracker's own token (`mcpKeys`), with no MCP setting of its own. */
  mcpShared?: boolean
  kind: string
  title: string
  /** A tracker's kind; else a CI's (Forgejo): no project runs on its profiles, a remote's CI takes one by its host. */
  tracker: boolean
  fields: { name: string; secret: boolean }[]
  /** Fixed while projects use a profile. */
  hostVariables: string[]
  /** Sets of fields of which a profile fills one (Huly: a token, or an e-mail and a password). */
  alternatives: string[][]
  help: string
  /** A tracker's that moves a task to a named status (BTN-554): its profiles and sources set the status moves. */
  moves?: boolean
}

/** A variable of the pool a package or a tracker reads; its value never leaves the service. */
export interface KeyView {
  name: string
  set: boolean
  /** The packages whose servers read it. */
  packages: string[]
}
