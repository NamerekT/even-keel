import type { AccountView } from './account/model.js'
import type { ActiveChain, Leftover, ProjectOrder } from './chain/dispatcher.js'
import type { FixEpisode, LaunchDay, TaskSession } from './chain/launches.js'
import type { ChainRules } from './chain/rules.js'
import type { CiKind, CiView, RemoteProfiles } from './ci/model.js'
import type { Language } from './language.js'
import type { RateLimits } from './limits/model.js'
import type { UsageHealth } from './limits/usage.js'
import type { Notice } from './notice/notice.js'
import type { Lamp } from './sessions/agents.js'
import type { Ask } from './sessions/ask.js'
import type { SessionMail } from './sessions/mail.js'
import type { SecretPlace, SecretReaders } from './secrets/catalog.js'
import type { TallyMode } from './stats/mode.js'
import type { CompareSettings } from './stats/rules.js'
import type { RemoteOff } from './sessions/remote.js'
import type { CacheWindow, FeedLine, Stage, TokenTotals } from './sessions/transcript.js'
import type { TrackerView } from './tracker/health.js'
import type { Task } from './tracker/model.js'
import type { UpdateSettings, UpdatesView } from './updates/release.js'

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
  /** The session waits on an `AskUserQuestion` the user has not answered. */
  asking: boolean
  /** That `AskUserQuestion`, for the answer panel of the chat window: from the transcript, or from the job file while the CLI has not written it there. */
  ask: Ask | null
  apiError: string | null
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
  remoteUrl: string | null
  remoteOff: RemoteOff | null
  account: string | null
}

export interface SessionRecord {
  sessionId: string
  startedAt: string | null
  lastActivityAt: string | null
  contextTokens: number
  /** As `SessionView.contextWindow`, only from the transcript. */
  contextWindow: number | null
  tokens: TokenTotals
  stage: Stage | null
  feed: FeedLine[]
  workdir: string | null
  branch: string | null
  apiError: string | null
  /** The e-mail of the account the session ran on. */
  account: string | null
}

/** Task link templates (`TrackerSetup.issueUrl`): `{id}` — the task id, `{number}` — its number. */
export interface TrackerUrls {
  default: string | null
  /** By the prefix of the task ids (`idPrefixOf`): projects with one prefix are on one tracker project. */
  projects: Record<string, string | null>
  /** The page of each project in its tracker (`TrackerSetup.projectUrl`); `null` — none. */
  pages: Record<string, string | null>
}

/**
 * What the user sets per project and the chain reads live: `branch`, `prompt`, `commands.beforeStart`, `commands.check`,
 * `commands.afterGreen`, `ci`, `remoteProfiles`, `pullRequests`, `mergeInto`, `fillMilestone`, `changelog`, `provider`, `models`, `accounts` and `modelLabels` in the config.
 */
export interface ProjectSettings {
  /** The project's main branch: tasks branch off it and merge into it, the CI watches it. */
  branch: string
  /** Added to the prompt of every new session of the project; `null` — none. */
  prompt: string | null
  /** Run in order in the task's folder before a new session starts. */
  beforeStart: string[]
  /** The project's check, run in order when no counted CI judges main: before a session merges, and on main if it moved. */
  check: string[]
  /** Run in order in the project's checkout once a push of main is green, if the checkout is on main at that commit. */
  afterGreen: string[]
  ci: CiSettings
  /** The profile the CI and the pull requests of the project's remotes of each kind take (BTN-231); none — the default. */
  remoteProfiles: RemoteProfiles
  /** PR mode (BTN-205): a session does not merge its branch, Even Keel pushes it and opens a pull request. */
  pullRequests: boolean
  /** A release project (BTN-172): the project whose branch its own one merges into once that project's chain is quiet; `null` — a main project. */
  mergeInto: string | null
  /** A task that enters the chain without a milestone gets the active one in the tracker. */
  fillMilestone: boolean
  /** The changelog file, relative to the repository's root (BTN-209). */
  changelog: string
  /** The provider the project's sessions run on (`claude`, `codex`); `null` — the shared one. A task's run label may override it. */
  provider: string | null
  /** The project's own model by provider, over the shared `models`. */
  models: Record<string, string>
  /** The project's own account folder by provider, over the shared `accounts`. */
  accounts: Record<string, string>
  /** Whether the tasks' run labels are read; `null` — as the shared `modelLabels` says. */
  modelLabels: boolean | null
  /** The language of the project's prompts and of what Even Keel writes into its tracker, the shared one filled in. */
  promptLanguage: Language
  /** The prompt cache TTL of the project's sessions, the shared one filled in; `null` — the CLI's own choice. */
  cacheTtl: CacheTtl | null
  /** The checkpoint hook's first threshold for the project, the shared one filled in; `null` — calibrated. */
  checkpointTokens: number | null
  /** The shares of the session's window the checkpoint thresholds come at, at most; each the shared one unless the project has its own. */
  checkpointShares: CheckpointShares
  /** The project's own rows of the keys Even Keel sets too (`ci.*` and the five above); a key left out — as shared. */
  own: OwnValues
}

/** The keys a project may set for itself or leave to Even Keel's value, which the settings panel shows as "as shared". */
export type OwnKey = keyof OwnValues

export interface OwnValues {
  'ci.guard'?: boolean
  'ci.kinds'?: CiKind[]
  'ci.waitMinutes'?: number | null
  'ci.recheckMain'?: boolean
  'ci.fixTask'?: boolean
  fillMilestone?: boolean
  promptLanguage?: Language
  cacheTtl?: CacheTtl | null
  'stats.checkpointTokens'?: number | null
  'stats.checkpointShares.first'?: number
  'stats.checkpointShares.late'?: number
  'stats.checkpointShares.hard'?: number
}

/** Which CIs of the project the chain counts after a push of main, and how long it waits for them. */
export interface CiSettings {
  /** The chain keeps main green: waits for the CIs, runs the check, fixes a red main. `false` — none of it, the keys below kept but unused. */
  guard: boolean
  kinds: CiKind[]
  /** `null` — as long as it takes, `0` — not at all. */
  waitMinutes: number | null
  /** Without a CI to judge it, main that is not the tree checked before the merge is checked again before the next launch. */
  recheckMain: boolean
  /** A red main gets a fix task in the tracker; without it a session with no task fixes main (BTN-115). */
  fixTask: boolean
}

/** The prompt cache lifetime a chain session is started with; the CLI picks its own without one. */
export type CacheTtl = '5m' | '1h'

export interface ContextScale {
  window: number
  warn: number
  danger: number
}

export interface StatsConfig {
  compare: CompareSettings
  /** Old folder → new folder: sessions in the old one count where it lives now. */
  moves: Record<string, string>
  /** A folder group costing less than this in all goes to Other on /stats. */
  otherBelow: number
  /** The checkpoint hook's first threshold for every project without its own; null leaves it to the calibration. */
  checkpointTokens: number | null
  /** The shares of the session's window the checkpoint thresholds come at, for every project without its own. */
  checkpointShares: CheckpointShares
}

/**
 * Percents of a session's context window, `first < late < hard`: the first nudge, the late nudges and the hard
 * threshold of a held task come at most at them (BTN-261). A threshold pinned by `checkpointTokens` ignores them.
 */
export interface CheckpointShares {
  first: number
  late: number
  hard: number
}

/** A project's entry of the config as the settings panel edits it: the values it ends up with, the shared ones filled in. */
export interface ProjectForm extends ProjectSettings {
  /** What the page shows next to the key. `null` — no name. */
  name: string | null
  repo: string
  tracker: string
  /** The project's key in its tracker (`github`: `owner/name`, `linear`: a project of the team, `huly`: a Huly project other than the key); `null` — the tracker has none, or it is optional and not set. */
  trackerProject: string | null
  /** Slots of the pool; `0` — a worktree per task. */
  slot: number
  /** The palette slot the page draws the project with, 1–8 (BTN-207); `null` — none was free, grey. */
  color: number | null
  /** `null` — on exactly when no package of the project brings its tracker's MCP server. */
  brief: boolean | null
  chain: ChainRules
}

/** The shared keys of the config as the settings page edits them, defaults filled in. */
export interface SharedForm {
  parallel: number
  tracker: string
  brief: boolean | null
  chain: ChainRules
  provider: string
  /** By provider, defaults filled in; a blank one leaves the provider to its CLI's default. */
  models: Record<string, string>
  /** By provider, defaults filled in; `claude` is also switched from the header. */
  accounts: Record<string, string>
  execution: Record<string, string>
  /** By provider: `checked` or `system` (BTN-250). */
  cli: Record<string, string>
  modelLabels: boolean
  /** By the model's name as the CLI gets it. */
  modelPrompts: Record<string, string>
  language: Language | null
  promptLanguage: Language
  hiddenSkills: string[]
  cacheTtl: CacheTtl | null
  /** What a project without its own `ci` keys or `fillMilestone` runs on. */
  ci: CiSettings
  fillMilestone: boolean
  allowedHosts: string[]
  context: ContextScale
  stats: StatsConfig
  /** The switches of `updates`; the closed version is written by the toast, not the form. */
  updates: Pick<UpdateSettings, 'check' | 'notify'>
}

/** A tracker the settings can pick, and the key a project on it names its tracker project with. */
export interface TrackerChoice {
  name: string
  /** The name on the page: `GitHub`, not `github`. */
  title: string
  /** `alias` — the value names the tracker's project in place of the key (Huly), see `TrackerProjectKey.alias`. */
  projectKey: { key: string; example: string; optional: boolean; alias: boolean } | null
}

/** A project the wizard of `/projects/add` is about to add; blank text — not given. */
export interface ProjectDraft {
  repo: string
  /** Blank — not chosen yet: the check suggests the checkout's current branch. */
  branch: string
  key: string
  name: string
  tracker: string
  trackerProject: string
  /** The tracker's profile the project runs on (`ProfileView.id`); `null` — the tracker's default profile. */
  profile: string | null
  /** Slots of the pool; `0` — a worktree per task. */
  slot: number
}

/** What the wizard's check found for a draft; a step that could not be checked yet is `null`. */
export interface ProjectCheck {
  repo: {
    /** The top of the repository the folder is in, as the entry will name it; `null` — not a git repository. */
    root: string | null
    /** The branch the checkout is on, the suggestion for the main branch; `null` — detached or not a repository. */
    current: string | null
    /** The draft tracker's project its remotes suggest (GitHub: `owner/name` of a github.com remote); `null` — none. */
    suggested: string | null
    notice: Notice | null
  }
  /** What `parseConfig` says of the config with the draft added; `null` — it parses. */
  entry: Notice | null
  /** Asked once the entry parses. */
  tracker: {
    ok: boolean
    /** The tracker's variables, when none of them is set. */
    missing: string[]
    /** Open tasks of the project in the tracker. */
    open: number | null
    /** Anyone can open a task in the tracker's project (a public GitHub repository) and no label is needed to enter the chain. */
    openToAll: boolean
    notice: Notice | null
  } | null
  /** Whether Claude Code trusts the folder; `null` — no repository to ask about. */
  trusted: boolean | null
  /** The platform of the service's machine (`process.platform`), which the folder is on: the trust command depends on it. */
  platform: string
}

/** How a release project's branch goes into the branch of the project it merges into (`mergeInto`, BTN-172). */
export interface ForwardView {
  into: string
  /** The commits of the release branch the other branch lacks; `null` — not read yet. */
  behind: number | null
  /** Why they wait; `null` — nothing waits. */
  hold: Notice | null
  /** A conflict holds them until "Carry now" or a merge by hand. */
  held: boolean
  /** The last carry: when, how many commits, and its push that failed. */
  last?: { at: string; commits: number; push: Notice | null }
}

/** The config file as the settings show it: the saved values, all applied on the fly. */
export interface ConfigView {
  shared: SharedForm
  projects: Record<string, ProjectForm>
  trackers: TrackerChoice[]
  /** Projects the chain has started a task of: the page does not switch their tracker or tracker project until BTN-66. */
  trackerLocked: string[]
}

/** A repository a checkout's remote points at. */
export interface RemoteRef {
  /** The same for every url of one repository: host and path in lower case, or a local remote's resolved path. */
  id: string
  /** What a group of its projects is titled with: `owner/repo`, or a local remote's folder name. */
  path: string
}

export type ProjectTask = Task & { project: string }

export interface EvenKeelState {
  startedAt: string
  /** The projects by their ids, as every map of a project here names them: two projects may share a key (BTN-271). */
  projects: string[]
  /** The key of each project; an old link of the page names a project by it. */
  projectKeys: Record<string, string>
  /** What the page shows each project by (`projectLabel`): its key, with its name where another project has the key. */
  projectLabels: Record<string, string>
  /** The prefix of each project's task ids (`idPrefixOf`): its key, or its tracker project's where that is another one. */
  taskPrefixes: Record<string, string>
  config: ConfigView
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
  /** The remotes of each project's checkout: Home groups the projects that share one (BTN-207). */
  remotes: Record<string, RemoteRef[]>
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
  updates: UpdatesView
  /** The installed CLIs whose version is not the one Even Keel was last checked against (BTN-249): a banner each until closed. */
  cliVersions: CliVersionView[]
  /** The last day's launches whose run label had no account in the pool, newest first: a toast each until dismissed. */
  fallbacks: FallbackLaunch[]
  /** The chat mailbox of each live session whose hooks ask for mail or that has messages to show, by session id (BTN-181). */
  mailbox: Record<string, SessionMail>
  /** The tasks the changelog written last accounts for, by project and milestone (BTN-209). */
  changelogs: Record<string, Record<string, string[]>>
  /** How each release project's branch goes into the project it merges into, by the release project (BTN-172). */
  forwards: Record<string, ForwardView>
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
export type ChangelogOp = { op: 'open' } | { op: 'again' } | { op: 'add' } | { op: 'edit'; instruction: string } | { op: 'write' }

/** A milestone's changelog draft as the page shows it: its newest version. */
export interface ChangelogView {
  /** The project key. */
  project: string
  milestone: string
  /** The changelog file, relative to the repository's root. */
  file: string
  /** The milestone's newest tag; `null` — not released. */
  released: string | null
  version: ChangelogVersion
  spent: ChangelogSpent
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
}

export interface ProjectPackages {
  /** By package name. */
  cells: Record<string, PackageCell>
  /** Problems of the set as a whole (`noTrackerMcp`). */
  problems: PackageProblem[]
  /** A problem holds the chain: it waits until the problem is gone. */
  blocked: boolean
  /** The tracker's MCP server and whether a package of the set brings it, whatever `brief` is; `null` — the tracker has none. */
  tracker: { server: string; brought: boolean } | null
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
  id: string
  kind: string
  name: string
  /** The kind's profile for the sessions started by hand, the GitHub Actions of other trackers' projects and new projects. */
  isDefault: boolean
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
}

/** A project's remote with a CI. */
export interface CiRemote {
  project: string
  remote: string
}

export interface ProfileKindView {
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
}

/** A variable of the pool a package or a tracker reads; its value never leaves the service. */
export interface KeyView {
  name: string
  set: boolean
  /** The packages whose servers read it. */
  packages: string[]
}
