import type { AccountView } from './account/model.js'
import type { ActiveChain, Leftover, ProjectOrder } from './chain/dispatcher.js'
import type { LaunchDay, TaskSession } from './chain/launches.js'
import type { ChainRules } from './chain/rules.js'
import type { CiKind, CiView } from './ci/model.js'
import type { Language } from './language.js'
import type { RateLimits } from './limits/model.js'
import type { UsageHealth } from './limits/usage.js'
import type { Notice } from './notice/notice.js'
import type { Lamp } from './sessions/agents.js'
import type { Ask } from './sessions/ask.js'
import type { CompareSettings } from './stats/rules.js'
import type { RemoteOff } from './sessions/remote.js'
import type { CacheWindow, FeedLine, Stage, TokenTotals } from './sessions/transcript.js'
import type { TrackerView } from './tracker/health.js'
import type { ModelAlias, Task } from './tracker/model.js'

export interface SessionView {
  task: string
  sessionId: string
  cwd: string
  lamp: Lamp
  /** The last line of the session's last response is `CHECKPOINT: <path>`: it waits to be handed over, not for an answer. */
  checkpoint: boolean
  waitingFor: string | null
  /** What the CLI dialog the session hangs on before its first turn asks for: not mid-turn, nobody in the background answers it. */
  startupDialog: string | null
  /** The session waits on an `AskUserQuestion` the user has not answered. */
  asking: boolean
  /** That `AskUserQuestion`, for the answer panel of the chat window: from the transcript, or from the job file while the CLI has not written it there. */
  ask: Ask | null
  apiError: string | null
  startedAt: string
  lastActivityAt: string | null
  contextTokens: number
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
  projects: Record<string, string | null>
}

/** What the user sets per project and the chain reads live: `branch`, `prompt`, `commands.beforeStart`, `commands.check`, `ci` and `fillMilestone` in the config. */
export interface ProjectSettings {
  /** The project's main branch: tasks branch off it and merge into it, the CI watches it. */
  branch: string
  /** Added to the prompt of every new session of the project; `null` — none. */
  prompt: string | null
  /** Run in order in the task's folder before a new session starts. */
  beforeStart: string[]
  /** The project's check, run in order when no counted CI judges main: before a session merges, and on main if it moved. */
  check: string[]
  ci: CiSettings
  /** A task that enters the chain without a milestone gets the active one in the tracker. */
  fillMilestone: boolean
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
  /** The checkpoint hook's first threshold for every project; null leaves it to the calibration. */
  checkpointTokens: number | null
}

/** A project's entry of the config as the settings panel edits it: the values it ends up with, the shared ones filled in. */
export interface ProjectForm extends ProjectSettings {
  /** What the page shows next to the key; the key stays the project's id. `null` — no name. */
  name: string | null
  repo: string
  tracker: string
  /** The project's key in its tracker (`github`: `owner/name`, `linear`: a project of the team); `null` — the tracker has none, or it is optional and not set. */
  trackerProject: string | null
  /** Slots of the pool; `0` — a worktree per task. */
  slot: number
  brief: boolean
  chain: ChainRules
}

/** The shared keys of the config as the settings page edits them, defaults filled in. */
export interface SharedForm {
  parallel: number
  tracker: string
  brief: boolean
  chain: ChainRules
  model: ModelAlias
  modelPrompts: Partial<Record<ModelAlias, string>>
  language: Language | null
  promptLanguage: Language
  hiddenSkills: string[]
  allowedHosts: string[]
  context: ContextScale
  stats: StatsConfig
}

/** A tracker the settings can pick, and the key a project on it names its tracker project with. */
export interface TrackerChoice {
  name: string
  projectKey: { key: string; example: string; optional: boolean } | null
}

/** The config file as the settings show it: saved values, which may wait for a restart. */
export interface ConfigView {
  shared: SharedForm
  projects: Record<string, ProjectForm>
  /** What is saved but waits for a restart of the service: `tracker`, `context`, `ABC.repo`, `ABC.slot`, `ABC.tracker`, `ABC.trackerProject`, or `ABC` for a new project. */
  restart: string[]
  trackers: TrackerChoice[]
  /** Projects the chain has started a task of: the page does not switch their tracker or tracker project until BTN-66. */
  trackerLocked: string[]
}

export interface EvenKeelState {
  startedAt: string
  projects: string[]
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
  tasks: Task[]
  sessions: SessionView[]
  limits: RateLimits | null
  usage: UsageHealth
  account: AccountView
  trackers: TrackerView[]
  trackerUrls: TrackerUrls
  /** The CIs of each project that has any; a project without CI has no key. */
  ci: Record<string, CiView[]>
  launches: LaunchDay[]
  taskSessions: Record<string, TaskSession[]>
  context: ContextScale
  configError: Notice | null
  mcpMissing: McpMissing[]
  language: Language | null
  unattended: boolean
  trimTools: boolean
}

/** A project with `brief` off whose sessions see no MCP server of its tracker. */
export interface McpMissing {
  project: string
  server: string
}
