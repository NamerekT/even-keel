import type { AccountEntry, AccountView } from '../../src/account/model.js'
import type { ActiveChain, CurrentTask, ProjectOrder } from '../../src/chain/dispatcher.js'
import { fixName, isFixName } from '../../src/chain/fix.js'
import type { TaskSession } from '../../src/chain/launches.js'
import { chainOrder, nextTask, precedence, withWaiting } from '../../src/chain/order.js'
import type { LimitHold } from '../../src/chain/relay.js'
import { isOpen, type ModelAlias, type StatusCategory, type Task, type TaskPriority } from '../../src/tracker/model.js'
import type { Lamp } from '../../src/sessions/agents.js'
import type { CacheTtl, CacheWindow, TokenTotals } from '../../src/sessions/transcript.js'
import type { UsageHealth } from '../../src/limits/usage.js'
import type { Notice } from '../../src/notice/notice.js'
import type { EvenKeelState, ContextScale, SessionView, TrackerUrls } from '../../src/state.js'
import { formatMoment } from './format.js'
import { say, t } from './i18n/index.js'

export interface AccountBadge {
  kind: 'in' | 'out' | 'login' | 'unknown'
  label: string
}

export function accountBadge(view: AccountView): AccountBadge {
  if (view.login !== null) {
    return view.login.error === null ? { kind: 'login', label: t.account.loggingIn } : { kind: 'out', label: t.account.loginFailed }
  }
  const active = view.accounts.find((entry) => entry.key === view.active)
  if (active?.status == null) return { kind: 'unknown', label: 'Claude' }
  if (active.needsLogin) return { kind: 'out', label: t.account.needsLogin }
  return { kind: 'in', label: active.status.email?.split('@')[0] ?? 'Claude' }
}

const DAY_MS = 24 * 60 * 60_000
const RENEW_WITHIN_DAYS = 7

export function loginLeft(expiresAt: string | null, now: Date): { text: string; renew: boolean } {
  if (expiresAt === null) return { text: '—', renew: false }
  const left = Date.parse(expiresAt) - now.getTime()
  if (left <= 0) return { text: t.account.expired, renew: true }
  const days = Math.floor(left / DAY_MS)
  return { text: days === 0 ? t.account.underDay : t.account.days(days), renew: days < RENEW_WITHIN_DAYS }
}

export function limitedUntil(entry: AccountEntry, now: Date): string | null {
  const spent = [entry.limits?.fiveHour, entry.limits?.sevenDay]
    .filter((window) => window != null && window.usedPercentage >= 100 && Date.parse(window.resetsAt) > now.getTime())
    .map((window) => window!.resetsAt)
  return spent.length === 0 ? null : spent.reduce((later, each) => (Date.parse(each) > Date.parse(later) ? each : later))
}

export function canWork(entry: AccountEntry, now: Date): boolean {
  return entry.status?.loggedIn === true && !entry.needsLogin && !entry.removing && limitedUntil(entry, now) === null
}

export function accountOrder(entries: AccountEntry[], now: Date): AccountEntry[] {
  return [...entries.filter((entry) => canWork(entry, now)), ...entries.filter((entry) => !canWork(entry, now))]
}

export type ChainStatus =
  | { kind: 'running'; limitUntil: string | null; slotWait?: Notice; ciWait?: { commit: string; since: string; local?: true } }
  | { kind: 'paused'; error: Notice | null }
  | { kind: 'queued'; position: number }
  | { kind: 'idle' }

export interface CardTask {
  id: string
  title: string | null
  lamp: BlockLamp
  next: boolean
}

/** The lamp of a task, the same wherever the task shows: `handoff` — its session ended on a checkpoint nobody took up. */
export type BlockLamp = 'done' | 'working' | 'waiting' | 'handoff' | 'stopped' | 'error' | 'limit' | 'ahead' | 'canceled'

export interface ChainBlock {
  id: string
  title: string | null
  status: string | null
  stage: StatusCategory | null
  lamp: BlockLamp
  open: boolean
  locked: boolean
  blockedBy: string[]
  milestone: string | null
  after: string[]
  current: boolean
  skipped: boolean
  question: boolean
  priority: TaskPriority
  estimate: number | null
  parent: string | null
  labels: string[]
  models: ModelAlias[]
  session: SessionView | null
  sessions: TaskSession[]
  limit: LimitHold | null
  start: SessionStart | null
  /** A red main stopped the task's session; it goes on once main is fixed. */
  interrupted?: true
  /** The fix of a red main leads the chain and this task is next: its live session takes no answer from the chat until the fix lands. */
  aside?: true
}

/**
 * `launch`, `handover` — the service is starting the session; `boot` — the page does not see the new session yet;
 * `answer` — the session is up and has not answered yet.
 */
export interface SessionStart {
  phase: StartPhase
  since: string
}

export type StartPhase = 'launch' | 'handover' | 'boot' | 'answer'

const BOOT_WAIT_MS = 5 * 60_000

export type ContextLevel = 'ok' | 'warn' | 'danger'

export const PROJECT_SLOTS = 8

const byNumber = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true })

export function projectTasks(state: EvenKeelState, project: string): Task[] {
  return state.tasks.filter((task) => task.id.startsWith(`${project}-`))
}

export function waitingSessions(sessions: SessionView[], tasks: Task[]): SessionView[] {
  const open = new Set(tasks.filter((task) => isOpen(task.status)).map((task) => task.id))
  const since = (view: SessionView) => Date.parse(view.lastActivityAt ?? view.startedAt)
  return sessions
    .filter((view) => view.lamp === 'waiting' && !view.checkpoint && (open.has(view.task) || isFixName(view.task)))
    .sort((a, b) => since(a) - since(b))
}

export function blockMetered(block: Pick<ChainBlock, 'current' | 'session'>): boolean {
  return block.session !== null && (block.current || block.session.lamp !== 'finished')
}

export function checkpointHandoffs(rows: TaskSession[]): number {
  return rows.filter((row) => row.how === 'checkpoint').length
}

export function taskProject(task: string): string {
  return task.replace(/-(\d+|FIX)$/, '')
}

export function chainProgress(tasks: Task[], order: ProjectOrder | undefined): { done: number; total: number; backlog: number } {
  const chain = new Set([...(order?.order ?? []), ...(order?.waiting ?? [])])
  const done = tasks.filter((task) => task.status.category === 'Won').length
  const open = tasks.filter((task) => task.status.category !== 'Won' && task.status.category !== 'Lost' && chain.has(task.id)).length
  return { done, total: done + open, backlog: order?.backlog.length ?? 0 }
}

export function backlogTasks(state: EvenKeelState, project: string): Task[] {
  const byId = new Map(projectTasks(state, project).map((task) => [task.id, task]))
  return (state.chain.projects[project]?.backlog ?? []).flatMap((id) => byId.get(id) ?? [])
}

export interface LinkedTask {
  id: string
  title: string | null
  lamp: BlockLamp
}

export interface TaskLinks {
  blockers: LinkedTask[]
  dependents: LinkedTask[]
}

const NO_LINKS: TaskLinks = { blockers: [], dependents: [] }

/**
 * The open tasks an open task waits for and the open ones waiting for it; a closed task holds nothing.
 * A blocker missing from `tasks` stays, as it cannot be told closed.
 */
export function taskLinks(tasks: Task[], sessions: SessionView[]): (id: string) => TaskLinks {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const waiting = new Map<string, string[]>()
  for (const task of tasks) {
    if (!isOpen(task.status)) continue
    for (const blocker of task.blockedBy) waiting.set(blocker, [...(waiting.get(blocker) ?? []), task.id])
  }
  const live = (id: string) => {
    const task = byId.get(id)
    return task === undefined || isOpen(task.status)
  }
  const linked = (ids: string[]): LinkedTask[] =>
    ids.toSorted(byNumber).map((id) => {
      const task = byId.get(id)
      return { id, title: task?.title ?? null, lamp: taskLamp(task, taskSession(sessions, id) ?? null) }
    })
  return (id) => {
    const task = byId.get(id)
    if (task === undefined || !isOpen(task.status)) return NO_LINKS
    return { blockers: linked(task.blockedBy.filter(live)), dependents: linked(waiting.get(id) ?? []) }
  }
}

export interface Ghost {
  id: string
  title: string
  milestone: string | null
  /** The chain task it would stand right before, `null` for the end. */
  before: string | null
}

/** The stand-in for a backlog task at the place the service says it would take; `null` — the chain would not take it. */
export function ghostOf(state: EvenKeelState, project: string, id: string | null): Ghost | null {
  const landing = state.chain.projects[project]?.landing
  if (id === null || landing === undefined || !Object.hasOwn(landing, id)) return null
  const task = state.tasks.find((each) => each.id === id)
  if (task === undefined) return null
  return { id, title: task.title, milestone: task.milestone?.label ?? null, before: landing[id] ?? null }
}

export function canReady(state: EvenKeelState, project: string): boolean {
  return state.trackers.some((view) => view.ready && view.projects.includes(project))
}

export function openQuestions(tasks: Task[]): number {
  return tasks.filter((task) => task.question && isOpen(task.status)).length
}

/** Whether the task's panel has a session to show: one that ran or runs, or one being started. */
export function hasSession(block: { locked: boolean; session: unknown; start: unknown }): boolean {
  return !block.locked && (block.session !== null || block.start !== null)
}

/**
 * Where the questions figure leads: the session of the first open question that has one — projects in the given
 * order, tasks in chain order — or, while none has a session, the page of the first project with a question.
 */
export function questionPath(state: EvenKeelState, projects: string[]): string | null {
  let page: string | null = null
  for (const project of projects) {
    const questions = new Set(projectTasks(state, project).filter((task) => task.question && isOpen(task.status)).map((task) => task.id))
    if (questions.size === 0) continue
    const block = chainBlocks(state, project).find((each) => questions.has(each.id) && hasSession(each))
    if (block !== undefined) return `/p/${project}#${block.id}`
    page ??= `/p/${project}`
  }
  return page
}

export function activeChain(chain: EvenKeelState['chain'], project: string): ActiveChain | undefined {
  return chain.active.find((each) => each.project === project)
}

/** Whether starting one more project runs it at once rather than queueing it. */
export function startsNow(chain: EvenKeelState['chain']): boolean {
  return chain.active.length < chain.parallel
}

export function chainStatus(chain: EvenKeelState['chain'], project: string): ChainStatus {
  const { queue } = chain
  const active = activeChain(chain, project)
  if (active !== undefined) {
    if (active.paused) return { kind: 'paused', error: active.error }
    return {
      kind: 'running',
      limitUntil: active.limitUntil ?? null,
      ...(active.slotWait === undefined ? {} : { slotWait: active.slotWait.notice }),
      ...(active.ciWait === undefined ? {} : { ciWait: active.ciWait }),
    }
  }
  const index = queue.indexOf(project)
  return index < 0 ? { kind: 'idle' } : { kind: 'queued', position: index + 1 }
}

export type ChainControl = 'start' | 'resume' | 'stop'
export type ControlsOff = 'running' | 'idle' | 'queued' | 'notLoaded' | 'failed' | 'empty'

export interface ChainControls {
  enabled: ChainControl[]
  /** The one button that gets the fill: never a disabled one. */
  primary: ChainControl | null
  /** Why a button cannot be pressed now. */
  off: ControlsOff | null
}

export function chainControls(status: ChainStatus, order: ProjectOrder | undefined): ChainControls {
  if (status.kind === 'running') return { enabled: ['stop'], primary: 'stop', off: 'running' }
  if (status.kind === 'paused') return { enabled: ['resume', 'stop'], primary: 'resume', off: null }
  const off = status.kind === 'queued' ? 'queued' : order === undefined ? 'notLoaded' : order.error !== null ? 'failed' : order.order.length === 0 ? 'empty' : null
  return off === null ? { enabled: ['start'], primary: 'start', off: 'idle' } : { enabled: [], primary: null, off }
}

export interface UsageNotice {
  tone: 'warn' | 'error'
  text: string
  key: string
}

export function usageNotice(health: UsageHealth): UsageNotice | null {
  if (health.state === 'unread') {
    return {
      tone: 'warn',
      text: t.banner.usageUnread(health.reason === null ? null : say(health.reason)),
      key: `unread:${health.since}`,
    }
  }
  if (health.state === 'off') {
    return {
      tone: 'error',
      text: t.banner.usageOff(health.reason === null ? null : say(health.reason)),
      key: `off:${health.since}`,
    }
  }
  return null
}

export function limitWaitText(until: string, now: Date): string {
  return t.banner.limitHold(formatMoment(until, now))
}

export function ciWaitText(wait: { commit: string; since: string; local?: true }, now: Date): string {
  return (wait.local === true ? t.banner.checkHold : t.banner.ciHold)(wait.commit.slice(0, 7), formatMoment(wait.since, now))
}

export function cardTask(state: EvenKeelState, project: string): CardTask | null {
  const current = activeChain(state.chain, project)?.current?.task
  const { order = [], waiting = [] } = state.chain.projects[project] ?? {}
  const id = current ?? nextTask(projectTasks(state, project), order, [...(state.chain.skipped[project] ?? []), ...waiting])
  if (id === undefined) return null
  const task = state.tasks.find((each) => each.id === id)
  return {
    id,
    title: isFixName(id) ? t.chain.fix : (task?.title ?? null),
    lamp: taskLamp(task, taskSession(state.sessions, id) ?? null),
    next: current === undefined,
  }
}

export function projectSlot(projects: string[], project: string): number | null {
  const index = projects.indexOf(project)
  return index < 0 || index >= PROJECT_SLOTS ? null : index + 1
}

export function sessionStart(current: CurrentTask, session: SessionView | null, runs: TaskSession[], now: Date): SessionStart | null {
  if (current.sessionId === null) return { phase: 'launch', since: current.starting ?? current.since }
  if (current.starting !== undefined) return { phase: 'handover', since: current.starting }
  const seen = session?.sessionId === current.sessionId ? session : null
  const since = runs.find((run) => run.sessionId === current.sessionId)?.at ?? seen?.startedAt
  if (since === undefined || now.getTime() - Date.parse(since) > BOOT_WAIT_MS) return null
  if (seen === null) return { phase: 'boot', since }
  return seen.lamp === 'working' && seen.contextTokens === 0 ? { phase: 'answer', since } : null
}

export function chainBlocks(state: EvenKeelState, project: string, now = new Date()): ChainBlock[] {
  const tasks = projectTasks(state, project)
  const order = state.chain.projects[project]
  const known = [...tasks, ...(order?.outside ?? [])]
  const byId = new Map(known.map((task) => [task.id, task]))
  const closed = tasks.filter((task) => !isOpen(task.status))
  const after = precedence(tasks.filter((task) => isOpen(task.status)))
  const broken = order === undefined || order.error !== null
  const waiting = new Set(broken ? [] : order.waiting)
  const open = broken
    ? tasks.filter((task) => isOpen(task.status)).map((task) => task.id).sort(byNumber)
    : withWaiting(order.order, order.waiting, new Map(known.map((task) => [task.id, task.blockedBy])))
  const active = activeChain(state.chain, project)
  const current = active?.current?.task
  const running = active?.current ?? null
  const hold = active?.current?.limit
  const pending = hold !== undefined && hold.acted === null ? hold : null
  const skipped = new Set(state.chain.skipped[project] ?? [])
  const fix = fixName(project)
  const next = current === fix && !broken && active?.interrupted === undefined ? nextTask(tasks, order.order, [...skipped, ...order.waiting]) : undefined

  const blocks =[...closedOrder(closed, state.taskSessions), ...open].map((id) => {
    const task = byId.get(id)
    const session = taskSession(state.sessions, id) ?? null
    const sessions = state.taskSessions[id] ?? []
    return {
      id,
      title: task?.title ?? null,
      status: task?.status.name ?? null,
      stage: task?.status.category ?? null,
      lamp: taskLamp(task, session),
      open: task !== undefined && isOpen(task.status) && !waiting.has(id),
      locked: waiting.has(id),
      blockedBy: task?.blockedBy ?? [],
      milestone: task?.milestone?.label ?? null,
      after: after.get(id) ?? [],
      current: id === current,
      skipped: skipped.has(id),
      question: task?.question ?? false,
      priority: task?.priority ?? 'none',
      estimate: task?.estimate ?? null,
      parent: task?.parent ?? null,
      labels: task?.labels ?? [],
      models: task?.models ?? [],
      session,
      sessions,
      limit: id === current ? pending : null,
      start: running?.task === id ? sessionStart(running, session, sessions, now) : null,
      ...(id === active?.interrupted?.task && { interrupted: true as const }),
      ...(id === next && session !== null && session.lamp !== 'finished' && { aside: true as const }),
    }
  })
  for (let index = blocks.length - 2; index >= 0; index--) {
    if (blocks[index]!.locked) blocks[index]!.milestone = blocks[index + 1]!.milestone
  }
  const fixSession = taskSession(state.sessions, fix) ?? null
  if (current !== fix && (fixSession === null || fixSession.lamp === 'finished')) return blocks
  // The fix session of a red main is not a tracker task: it leads the chain as a block of its own, ahead of the open tasks.
  const at = blocks.findIndex((block) => block.open || block.locked)
  const ahead = at < 0 ? blocks.length : at
  const fixSessions = state.taskSessions[fix] ?? []
  const fixBlock: ChainBlock = {
    id: fix,
    title: t.chain.fix,
    status: null,
    stage: null,
    lamp: taskLamp(undefined, fixSession),
    open: true,
    locked: false,
    blockedBy: [],
    milestone: blocks[ahead]?.milestone ?? null,
    after: [],
    current: fix === current,
    skipped: false,
    question: false,
    priority: 'none',
    estimate: null,
    parent: null,
    labels: [],
    models: [],
    session: fixSession,
    sessions: fixSessions,
    limit: fix === current ? pending : null,
    start: running?.task === fix ? sessionStart(running, fixSession, fixSessions, now) : null,
  }
  return blocks.toSpliced(ahead, 0, fixBlock)
}

export function contextFill(tokens: number, scale: ContextScale): { percent: number; level: ContextLevel } {
  const percent = Math.min(100, (tokens / scale.window) * 100)
  const level = percent >= scale.danger ? 'danger' : percent >= scale.warn ? 'warn' : 'ok'
  return { percent, level }
}

export function queuedAfter(chain: EvenKeelState['chain'], project: string): string | null {
  const index = chain.queue.indexOf(project)
  if (index < 0) return null
  if (index > 0) return chain.queue[index - 1]!
  return chain.active.length === 1 ? chain.active[0]!.project : null
}

export function sessionElapsed(view: SessionView, now: Date): number {
  const start = Date.parse(view.startedAt)
  const end = view.lamp === 'finished' ? Date.parse(view.lastActivityAt ?? view.startedAt) : now.getTime()
  return Math.max(0, end - start)
}

const CACHE_TTL_MS: Record<CacheTtl, number> = { '5m': 5 * 60_000, '1h': 60 * 60_000 }

export function cacheFreshness(cache: CacheWindow, now: Date): { left: number; level: 'ok' | 'warn' | 'cold' } {
  const left = Math.max(0, Date.parse(cache.until) - now.getTime())
  const level = left === 0 ? 'cold' : left < CACHE_TTL_MS[cache.ttl] / 5 ? 'warn' : 'ok'
  return { left, level }
}

/** How loud the panel draws the cache: quiet until it is about to run out, and for a finished session always. */
export function cacheTone(cache: CacheWindow | null, now: Date, lamp: Lamp): ContextLevel {
  if (cache === null || lamp === 'finished') return 'ok'
  const { level } = cacheFreshness(cache, now)
  return level === 'cold' ? 'danger' : level
}

export function tokenTotal(tokens: TokenTotals): number {
  return tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite
}

export function issueLink(urls: TrackerUrls, task: string): string | null {
  if (isFixName(task)) return null
  const project = taskProject(task)
  const template = Object.hasOwn(urls.projects, project) ? urls.projects[project]! : urls.default
  return template === null ? null : template.replaceAll('{id}', task).replaceAll('{number}', task.slice(project.length + 1))
}

function taskSession(sessions: SessionView[], task: string): SessionView | undefined {
  const own = sessions.filter((view) => view.task === task)
  return own.find((view) => view.lamp !== 'finished') ?? own.at(-1)
}

function closedOrder(tasks: Task[], runs: Record<string, TaskSession[]>): string[] {
  let order: string[]
  try {
    order = chainOrder(tasks)
  } catch {
    order = tasks.map((task) => task.id).sort(byNumber)
  }
  const lastRun = (id: string) => runs[id]?.reduce((last, run) => (run.at > last ? run.at : last), '') ?? ''
  const never = order.filter((id) => lastRun(id) === '')
  const ran = order.filter((id) => lastRun(id) !== '').sort((a, b) => lastRun(a).localeCompare(lastRun(b)))
  return [...never, ...ran]
}

/** The tracker's status first: a finished session lights a task done only when the task is done. */
function taskLamp(task: Task | undefined, session: SessionView | null): BlockLamp {
  if (task?.status.category === 'Won') return 'done'
  if (task?.status.category === 'Lost') return 'canceled'
  if (session === null) return 'ahead'
  if (session.checkpoint && (session.lamp === 'waiting' || session.lamp === 'finished')) return 'handoff'
  return session.lamp === 'finished' ? 'stopped' : session.lamp
}
