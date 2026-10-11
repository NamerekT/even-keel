import type { FinishOutcome } from '../git/types.js'
import type { Language } from '../language.js'
import type { Notice } from '../notice/notice.js'
import type { Task } from '../tracker/model.js'
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
  closing?: string
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
  resume:(task: string, session: LimitedSession) => Promise<string>
  /** Stops the waiting session and resumes it with the user's reply; returns the session id it came up under. */
  reply: (task: string, session: HandoffSession, prompt: string) => Promise<string>
  relay: (task: string, session: HandoffSession, prompt: string, reason: HandoffReason) => Promise<string>
  finish: (project: string, task: string) => Promise<FinishOutcome>
  log: (message: string) => void
}

export function emptyChainState(): ChainState {
  return { active: [], queue: [], orders: {}, skipped: {}, leftovers: {}, released: {}, unattended: false, trimTools: true }
}

export function newChain(project: string): ActiveChain {
  return { project, current: null, paused: false, error: null }
}
