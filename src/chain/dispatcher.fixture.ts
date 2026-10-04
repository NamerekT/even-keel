import type { FinishOutcome } from '../git/types.js'
import { textNotice } from '../notice/notice.js'
import { fakeTask } from '../tracker/fixture.js'
import type { Task, TaskStatus } from '../tracker/model.js'
import { Dispatcher, emptyChainState, type ChainState, type LaunchEntry } from './dispatcher.js'
import type { AccountNow, HandoffSession, LimitedSession } from './relay.js'
import { DEFAULT_RULES, type ChainRules } from './rules.js'

export const backlog: TaskStatus = { name: 'Backlog', category: 'UnStarted' }
export const review: TaskStatus = { name: 'In Review', category: 'Active' }
export const todo: TaskStatus = { name: 'Todo', category: 'ToDo' }
export const active: TaskStatus = { name: 'In Progress', category: 'Active' }
export const done: TaskStatus = { name: 'Done', category: 'Won' }
export const canceled: TaskStatus = { name: 'Canceled', category: 'Lost' }

export const task = (id: string, status: TaskStatus = todo, ...blockedBy: string[]): Task => fakeTask(id, { status, blockedBy })

export interface SetupOptions {
  state?: ChainState
  failLaunch?: string
  live?: Record<string, string>
  projects?: string[]
  blocked?: string
  limited?: Record<string, LimitedSession>
  account?: AccountNow
  accountAt?: (account: string, at: string) => string | null
  failRelay?: boolean
  limitReset?: string | null
  busy?: Set<string>
  waiting?: Set<string>
  unattended?: boolean
  located?: Partial<HandoffSession>
  finish?: (task: string) => FinishOutcome
  rules?: Record<string, ChainRules>
}

export function setup(options: SetupOptions = {}) {
  const busy = options.busy ?? new Set<string>()
  const clock = { now: new Date('2026-09-26T12:00:00Z') }
  const account: AccountNow = options.account ?? { id: 'john@example.com', ready: true }
  const limited: Record<string, LimitedSession> = options.limited ?? {}
  const handoffs: Record<string, HandoffSession> = {}
  const relays: { kind: string; task: string; sessionId: string; prompt?: string; workdir?: string }[] = []
  const launched: string[] = []
  const finished: string[] = []
  const saved: ChainState[] = []
  const journal: LaunchEntry[] = []
  let counter = 0
  const state = options.state ?? emptyChainState()
  if (options.unattended !== undefined) state.unattended = options.unattended
  const dispatcher = new Dispatcher(state, {
    projects: options.projects ?? ['ABC', 'XYZ'],
    rules: (project) => options.rules?.[project] ?? DEFAULT_RULES,
    launch: async (project, id) => {
      if (id === options.failLaunch) throw new Error(`claude: could not start ${id}`)
      launched.push(`${project}/${id}`)
      return `session-${++counter}`
    },
    liveSession: (id) => options.live?.[id],
    blocked: () => (options.blocked === undefined ? undefined : textNotice(options.blocked)),
    busy: (id) => busy.has(id) || (options.waiting?.has(id) ?? false),
    midTurn: (id) => busy.has(id) && !(options.waiting?.has(id) ?? false),
    save: (state) => saved.push(structuredClone(state)),
    journal: (entry) => journal.push(entry),
    now: () => clock.now,
    limited: (id) => limited[id],
    handoff: (id) => handoffs[id],
    locate: async (session) => ({ ...session, ...options.located }),
    account: () => account,
    accountAt: options.accountAt ?? (() => account.id),
    limitReset: () => options.limitReset ?? null,
    promptLanguage: () => 'ru',
    resume: async (_task, session) => {
      relays.push({ kind: 'resume', task: '', sessionId: session.sessionId })
      return session.sessionId
    },
    relay: async (id, session, prompt) => {
      if (options.failRelay) throw new Error(`claude: could not stop ${session.agentId}`)
      relays.push({ kind: 'relay', task: id, sessionId: session.sessionId, prompt, workdir: session.workdir })
      return `session-${++counter}`
    },
    finish: async (project, id) => {
      finished.push(`${project}/${id}`)
      return options.finish?.(id) ?? { warnings: [], syncError: null }
    },
  })
  return { dispatcher, launched, finished, saved, journal, clock, account, limited, handoffs, relays, busy }
}
