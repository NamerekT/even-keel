import type { FinishOutcome } from '../git/types.js'
import { textNotice } from '../notice/notice.js'
import { fakeTask } from '../tracker/fixture.js'
import type { Task, TaskStatus } from '../tracker/model.js'
import { Dispatcher, emptyChainState, type ChainState, type LaunchEntry } from './dispatcher.js'
import type { MainCheckDeps } from './model.js'
import type { AccountNow, HandoffSession, LimitedSession } from './relay.js'
import { DEFAULT_RULES, type ChainRules } from './rules.js'

export const backlog: TaskStatus = { name: 'Backlog', category: 'UnStarted' }
export const review: TaskStatus = { name: 'In Review', category: 'Active' }
export const todo: TaskStatus = { name: 'Todo', category: 'ToDo' }
export const active: TaskStatus = { name: 'In Progress', category: 'Active' }
export const done: TaskStatus = { name: 'Done', category: 'Won' }
export const canceled: TaskStatus = { name: 'Canceled', category: 'Lost' }

export const task = (id: string, status: TaskStatus = todo, ...blockedBy: string[]): Task => fakeTask(id, { status, blockedBy })

/** Puts a chain into the state the dispatcher itself sets after an error. */
export function pause(dispatcher: Dispatcher, project: string): void {
  const chain = dispatcher.state.active.find((candidate) => candidate.project === project)
  if (chain === undefined) throw new Error(`no active chain ${project}`)
  chain.paused = true
  dispatcher['changed']()
}

export interface SetupOptions {
  state?: ChainState
  failLaunch?: string
  /** The provider whose run label a task's launch could not honour, by task. */
  fallback?: Record<string, string>
  /** Launch errors by task; the test deletes an entry to let the next attempt through. */
  refuse?: Record<string, Error>
  live?: Record<string, string>
  projects?: string[]
  parallel?: number
  blocked?: string
  limited?: Record<string, LimitedSession>
  account?: AccountNow
  accountAt?: (account: string, at: string) => string | null
  failRelay?: boolean
  failStop?: boolean
  limitReset?: string | null
  limitResetAfter?: (account: string, at: string) => string | null
  /** Projects whose set of packages has a problem that holds the chain. */
  packagesBlocked?: Set<string>
  busy?: Set<string>
  waiting?: Set<string>
  /** The open `AskUserQuestion` of a task's session, by task. */
  asked?: Record<string, string>
  unattended?: boolean
  located?: Partial<HandoffSession>
  finish?: (task: string) => FinishOutcome
  rules?: Record<string, ChainRules>
  main?: MainCheckDeps
}

export function setup(options: SetupOptions = {}) {
  const busy = options.busy ?? new Set<string>()
  const live: Record<string, string> = options.live ?? {}
  const clock = { now: new Date('2026-09-26T12:00:00Z') }
  const account: AccountNow = options.account ?? { id: 'john@example.com', ready: true }
  const limited: Record<string, LimitedSession> = options.limited ?? {}
  const handoffs: Record<string, HandoffSession> = {}
  const relays: { kind: string; task: string; sessionId: string; prompt?: string; workdir?: string; reason?: string }[] = []
  const launched: string[] = []
  const fixes: { project: string; name: string; report: string }[] = []
  const stopped: string[] = []
  const tried: string[] = []
  const refuse = options.refuse ?? {}
  const log: string[] = []
  const finished: string[] = []
  const saved: ChainState[] = []
  const journal: LaunchEntry[] = []
  /** What a read of the tracker out of turn (`refresh`) hands over, by project; none — the tracker does not answer. */
  const tracker: Record<string, Task[]> = {}
  const refreshed: string[] = []
  let counter = 0
  const capacity = { parallel: options.parallel ?? 1 }
  const state = options.state ?? emptyChainState()
  if (options.unattended !== undefined) state.unattended = options.unattended
  const dispatcher = new Dispatcher(state, {
    projects: options.projects ?? ['ABC', 'XYZ', 'DEF'],
    parallel: () => capacity.parallel,
    rules: (project) => options.rules?.[project] ?? DEFAULT_RULES,
    launch: async (project, id) => {
      tried.push(`${project}/${id}`)
      if (id === options.failLaunch) throw new Error(`claude: could not start ${id}`)
      if (refuse[id] !== undefined) throw refuse[id]
      launched.push(`${project}/${id}`)
      return { sessionId: `session-${++counter}`, ...(options.fallback?.[id] !== undefined && { fallback: options.fallback[id] }) }
    },
    liveSession: (id) => live[id],
    blocked: () => (options.blocked === undefined ? undefined : textNotice(options.blocked)),
    busy: (id) => busy.has(id) || (options.waiting?.has(id) ?? false),
    midTurn: (id) => busy.has(id) && !(options.waiting?.has(id) ?? false),
    asked: (id) => options.asked?.[id] ?? null,
    save: (state) => saved.push(structuredClone(state)),
    journal: (entry) => journal.push(entry),
    now: () => clock.now,
    limited: (id) => limited[id],
    handoff: (id) => handoffs[id],
    locate: async (session) => ({ ...session, ...options.located }),
    account: () => account,
    accountAt: options.accountAt ?? (() => account.id),
    limitReset: () => options.limitReset ?? null,
    limitResetAfter: options.limitResetAfter ?? (() => options.limitReset ?? null),
    packagesBlocked: (project) => options.packagesBlocked?.has(project) ?? false,
    promptLanguage: () => 'ru',
    mainBranch: () => 'main',
    resume: async (_task, session) => {
      relays.push({ kind: 'resume', task: '', sessionId: session.sessionId })
      return session.sessionId
    },
    reply: async (id, session, prompt) => {
      relays.push({ kind: 'reply', task: id, sessionId: session.sessionId, prompt })
      return session.sessionId
    },
    relay: async (id, session, prompt, reason) => {
      if (options.failRelay) throw new Error(`claude: could not stop ${session.agentId}`)
      relays.push({ kind: 'relay', task: id, sessionId: session.sessionId, prompt, workdir: session.workdir, reason })
      return `session-${++counter}`
    },
    launchFix: async (project, name, report) => {
      if (name === options.failLaunch) throw new Error(`claude: could not start ${name}`)
      launched.push(`${project}/${name}`)
      fixes.push({ project, name, report })
      return `session-${++counter}`
    },
    stop: async (session) => {
      if (options.failStop) throw new Error(`claude: could not stop ${session.agentId}`)
      stopped.push(session.sessionId)
    },
    finish: async (project, id) => {
      finished.push(`${project}/${id}`)
      return options.finish?.(id) ?? { warnings: [], syncError: null }
    },
    refresh: async (project) => {
      refreshed.push(project)
      const tasks = tracker[project]
      if (tasks !== undefined) dispatcher.setTasks(project, tasks)
    },
    log: (message) => log.push(message),
    ...(options.main === undefined ? {} : { main: options.main }),
  })
  return {
    dispatcher,
    launched,
    fixes,
    stopped,
    live,
    tried,
    refuse,
    log,
    finished,
    saved,
    journal,
    clock,
    account,
    limited,
    handoffs,
    relays,
    busy,
    capacity,
    tracker,
    refreshed,
  }
}
