import type { AccountView } from './account/model.js'
import type { ActiveChain, Leftover, ProjectOrder } from './chain/dispatcher.js'
import type { LaunchDay, TaskSession } from './chain/launches.js'
import type { Language } from './language.js'
import type { RateLimits } from './limits/model.js'
import type { UsageHealth } from './limits/usage.js'
import type { Notice } from './notice/notice.js'
import type { Lamp } from './sessions/agents.js'
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

export interface ContextScale {
  window: number
  warn: number
  danger: number
}

export interface EvenKeelState {
  startedAt: string
  projects: string[]
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
