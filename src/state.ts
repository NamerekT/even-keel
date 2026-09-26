import type { ActiveChain, ProjectOrder } from './chain/dispatcher.js'
import type { HulyTask } from './huly/model.js'
import type { RateLimits } from './limits/model.js'
import type { Lamp } from './sessions/agents.js'
import type { FeedLine, Stage, TokenTotals } from './sessions/transcript.js'

export interface SessionView {
  task: string
  sessionId: string
  cwd: string
  lamp: Lamp
  waitingFor: string | null
  apiError: string | null
  startedAt: string
  lastActivityAt: string | null
  contextTokens: number
  tokens: TokenTotals
  stage: Stage | null
  action: FeedLine | null
  feed: FeedLine[]
  remoteUrl: string | null
}

export interface BatonState {
  startedAt: string
  projects: string[]
  chain: { active: ActiveChain | null; queue: string[]; projects: Record<string, ProjectOrder> }
  tasks: HulyTask[]
  sessions: SessionView[]
  limits: RateLimits | null
}
