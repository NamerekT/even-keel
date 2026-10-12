import type { AccountView } from './account/model.js'
import type { ActiveChain, Leftover, ProjectOrder } from './chain/dispatcher.js'
import type { LaunchDay, TaskSession } from './chain/launches.js'
import type { CiKind, CiView } from './ci/model.js'
import type { Language } from './language.js'
import type { RateLimits } from './limits/model.js'
import type { UsageHealth } from './limits/usage.js'
import type { Notice } from './notice/notice.js'
import type { Lamp } from './sessions/agents.js'
import type { Ask } from './sessions/ask.js'
import type { RemoteOff } from './sessions/remote.js'
import type { CacheWindow, FeedLine, Stage, TokenTotals } from './sessions/transcript.js'
import type { TrackerView } from './tracker/health.js'
import type { Task } from './tracker/model.js'

export interface SessionView {
  task: string
  sessionId: string
  cwd: string
  lamp: Lamp
  waitingFor: string | null
  /** What the CLI dialog the session hangs on before its first turn asks for: not mid-turn, nobody in the background answers it. */
  startupDialog: string | null
  /** The transcript ends in an `AskUserQuestion` the user has not answered. */
  asking: boolean
  /** That `AskUserQuestion`, for the answer panel of the chat window. */
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

/** What the user sets per project: `prompt`, `commands.beforeStart`, `commands.check` and `ci` in the config. */
export interface ProjectSettings {
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

export interface EvenKeelState {
  startedAt: string
  projects: string[]
  settings: Record<string, ProjectSettings>
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
