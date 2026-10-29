import type { FinishOutcome } from '../git/types.js'
import { textNotice, type Notice } from '../notice/notice.js'
import { fakeTask } from '../tracker/fixture.js'
import type { Task, TaskStatus } from '../tracker/model.js'
import { Dispatcher, emptyChainState, type ChainState, type LaunchEntry } from './dispatcher.js'
import type { DispatcherDeps, MainCheckDeps, PullCleanup, ReviewDeps, UnchangedDeps } from './model.js'
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
  blocked?: string | Notice
  modelRefusal?: DispatcherDeps['modelRefusal']
  limited?: Record<string, LimitedSession>
  overage?: (task: string) => LimitedSession | undefined
  account?: AccountNow
  accountAt?: (account: string, at: string) => string | null
  failRelay?: boolean
  reply?: DispatcherDeps['reply']
  failStop?: boolean
  limitReset?: string | null
  limitResetAfter?: (account: string, at: string, text?: string) => string | null
  /** Projects whose set of packages has a problem that holds the chain. */
  packagesBlocked?: Set<string>
  /** Whether the service has read its account folders since its start; absent — it has. */
  accountsRead?: boolean
  busy?: Set<string>
  silentSince?: Record<string, string>
  waiting?: Set<string>
  /** Sessions whose turn has ended while their own background command runs: busy and mid-turn to the chain. */
  shell?: Set<string>
  /** The open `AskUserQuestion` of a task's session, by task. */
  asked?: Record<string, string>
  unattended?: boolean
  located?: Partial<HandoffSession>
  finish?: (task: string) => FinishOutcome
  /** What a sync of main out of a cleanup gives, by project; absent — it goes through. */
  sync?: (project: string) => Notice | null
  /** By project, or by the id prefix of a feed's tasks. */
  rules?: Record<string, ChainRules>
  fillMilestone?: boolean
  main?: MainCheckDeps
  reviews?: ReviewDeps
  unchanged?: UnchangedDeps
}

export function setup(options: SetupOptions = {}) {
  const busy = options.busy ?? new Set<string>()
  const shell = options.shell ?? new Set<string>()
  const waiting = options.waiting ?? new Set<string>()
  const live: Record<string, string> = options.live ?? {}
  const clock = { now: new Date('2026-09-26T12:00:00Z') }
  const account: AccountNow = options.account ?? { id: 'john@example.com', ready: true }
  const limited: Record<string, LimitedSession> = options.limited ?? {}
  const handoffs: Record<string, HandoffSession> = {}
  const relays: { kind: string; task: string; sessionId: string; prompt?: string; workdir?: string; reason?: string; stopped?: true }[] = []
  const launched: string[] = []
  const fixes: { project: string; name: string; report: string }[] = []
  const carries: { project: string; name: string; report: string }[] = []
  /** The release commits each project's branch has, `<project>/<commit>`. */
  const carried = new Set<string>()
  const stopped: string[] = []
  const tried: string[] = []
  const refuse = options.refuse ?? {}
  const log: string[] = []
  const finished: string[] = []
  const synced: string[] = []
  /** The cleanups after tasks with a pull request, by task. */
  const pulled: Record<string, PullCleanup> = {}
  /** The text each launch carried at the end of its prompt, by task. */
  const extras: Record<string, string> = {}
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
    projects: () => options.projects ?? ['ABC', 'XYZ', 'DEF'],
    parallel: () => capacity.parallel,
    fillsMilestone: () => options.fillMilestone ?? false,
    rules: (project, task) => (task === undefined ? undefined : options.rules?.[task.slice(0, task.lastIndexOf('-'))]) ?? options.rules?.[project] ?? DEFAULT_RULES,
    launch: async (project, id, extra) => {
      tried.push(`${project}/${id}`)
      if (extra !== undefined) extras[id] = extra
      if (id === options.failLaunch) throw new Error(`claude: could not start ${id}`)
      if (refuse[id] !== undefined) throw refuse[id]
      launched.push(`${project}/${id}`)
      return { sessionId: `session-${++counter}`, ...(options.fallback?.[id] !== undefined && { fallback: options.fallback[id] }) }
    },
    liveSession: (id) => live[id],
    blocked: () => (typeof options.blocked === 'string' ? textNotice(options.blocked) : options.blocked),
    modelRefusal: options.modelRefusal,
    busy: (id) => busy.has(id) || shell.has(id) || waiting.has(id),
    silentSince: (id) => options.silentSince?.[id] ?? null,
    midTurn: (id) => (busy.has(id) || shell.has(id)) && !waiting.has(id),
    shell: (id) => shell.has(id),
    asked: (id) => options.asked?.[id] ?? null,
    save: (state) => saved.push(structuredClone(state)),
    journal: (entry) => journal.push(entry),
    now: () => clock.now,
    limited: (id) => limited[id],
    overage: options.overage,
    handoff: (id) => handoffs[id],
    locate: async (session) => ({ ...session, ...options.located }),
    account: () => account,
    accountAt: options.accountAt ?? (() => account.id),
    limitReset: () => options.limitReset ?? null,
    limitResetAfter: options.limitResetAfter ?? (() => options.limitReset ?? null),
    packagesBlocked: (project) => options.packagesBlocked?.has(project) ?? false,
    accountsRead: () => options.accountsRead ?? true,
    promptLanguage: () => 'ru',
    mainBranch: () => 'main',
    resume: async (_task, session) => {
      relays.push({ kind: 'resume', task: '', sessionId: session.sessionId, ...(session.stopped && { stopped: true }) })
      return session.sessionId
    },
    reply: options.reply ?? (async (id, session, prompt) => {
      relays.push({ kind: 'reply', task: id, sessionId: session.sessionId, prompt })
      return session.sessionId
    }),
    relay: async (id, session, prompt, reason) => {
      if (options.failRelay) throw new Error(`claude: could not stop ${session.agentId}`)
      relays.push({ kind: 'relay', task: id, sessionId: session.sessionId, prompt, workdir: session.workdir, reason, ...(session.stopped && { stopped: true }) })
      return `session-${++counter}`
    },
    launchFix: async (project, name, report) => {
      if (name === options.failLaunch) throw new Error(`claude: could not start ${name}`)
      launched.push(`${project}/${name}`)
      fixes.push({ project, name, report })
      return `session-${++counter}`
    },
    launchCarry: async (project, name, report) => {
      launched.push(`${project}/${name}`)
      carries.push({ project, name, report })
      return `session-${++counter}`
    },
    carried: async (project, commit) => carried.has(`${project}/${commit}`),
    stop: async (session) => {
      if (options.failStop) throw new Error(`claude: could not stop ${session.agentId}`)
      stopped.push(session.sessionId)
    },
    finish: async (project, id, pull) => {
      finished.push(`${project}/${id}`)
      if (pull !== undefined) pulled[id] = pull
      return options.finish?.(id) ?? { warnings: [], syncError: null }
    },
    sync: async (project) => {
      synced.push(project)
      return options.sync?.(project) ?? null
    },
    refresh: async (project) => {
      refreshed.push(project)
      const tasks = tracker[project]
      if (tasks !== undefined) dispatcher.setTasks(project, tasks)
    },
    log: (message) => log.push(message),
    ...(options.main === undefined ? {} : { main: options.main }),
    ...(options.reviews === undefined ? {} : { reviews: options.reviews, pullRequests: () => true }),
    ...(options.unchanged === undefined ? {} : { unchanged: options.unchanged }),
  })
  return {
    dispatcher,
    launched,
    fixes,
    carries,
    carried,
    stopped,
    live,
    tried,
    refuse,
    log,
    finished,
    synced,
    pulled,
    extras,
    saved,
    journal,
    clock,
    account,
    limited,
    handoffs,
    relays,
    busy,
    shell,
    waiting,
    capacity,
    tracker,
    refreshed,
  }
}
