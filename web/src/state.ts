import type { AccountView } from '../../src/account/model.js'
import type { TaskSession } from '../../src/chain/launches.js'
import { chainOrder, nextTask, precedence } from '../../src/chain/order.js'
import type { LimitHold } from '../../src/chain/relay.js'
import { isOpen, type HulyTask } from '../../src/huly/model.js'
import type { Lamp } from '../../src/sessions/agents.js'
import type { CacheTtl, CacheWindow, TokenTotals } from '../../src/sessions/transcript.js'
import type { UsageHealth } from '../../src/limits/usage.js'
import type { EvenKeelState, ContextScale, SessionView } from '../../src/state.js'
import { formatMoment } from './format.js'

export type CardLamp = Lamp | 'idle'

export interface AccountBadge {
  kind: 'in' | 'out' | 'login' | 'unknown'
  label: string
}

export function accountBadge(view: AccountView): AccountBadge {
  if (view.login !== null) return view.login.error === null ? { kind: 'login', label: 'Вход…' } : { kind: 'out', label: 'Вход не удался' }
  const active = view.accounts.find((entry) => entry.key === view.active)
  if (active?.status == null) return { kind: 'unknown', label: 'Claude' }
  if (active.needsLogin) return { kind: 'out', label: 'Нужен вход' }
  return { kind: 'in', label: active.status.email?.split('@')[0] ?? 'Claude' }
}

const DAY_MS = 24 * 60 * 60_000
const RENEW_WITHIN_DAYS = 7

export function loginLeft(expiresAt: string | null, now: Date): { text: string; renew: boolean } {
  if (expiresAt === null) return { text: '—', renew: false }
  const left = Date.parse(expiresAt) - now.getTime()
  if (left <= 0) return { text: 'истёк', renew: true }
  const days = Math.floor(left / DAY_MS)
  return { text: days === 0 ? 'меньше суток' : `${days} дн.`, renew: days < RENEW_WITHIN_DAYS }
}

export type ChainStatus =
  | { kind: 'running'; limitUntil: string | null }
  | { kind: 'paused'; error: string | null }
  | { kind: 'queued'; position: number }
  | { kind: 'idle' }

export interface CardTask {
  id: string
  title: string | null
  lamp: CardLamp
  next: boolean
}

export type BlockLamp = 'done' | 'working' | 'waiting' | 'stopped' | 'error' | 'limit' | 'ahead' | 'canceled'

export interface ChainBlock {
  id: string
  title: string | null
  status: string | null
  lamp: BlockLamp
  open: boolean
  blockedBy: string[]
  milestone: string | null
  after: string[]
  current: boolean
  skipped: boolean
  question: boolean
  session: SessionView | null
  sessions: TaskSession[]
  limit: LimitHold | null
}

export type ContextLevel = 'ok' | 'warn' | 'danger'

export const PROJECT_SLOTS = 8

const byNumber = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true })

export function projectTasks(state: EvenKeelState, project: string): HulyTask[] {
  return state.tasks.filter((task) => task.id.startsWith(`${project}-`))
}

export function waitingSessions(sessions: SessionView[], tasks: HulyTask[]): SessionView[] {
  const open = new Set(tasks.filter((task) => isOpen(task.status)).map((task) => task.id))
  const since = (view: SessionView) => Date.parse(view.lastActivityAt ?? view.startedAt)
  return sessions.filter((view) => view.lamp === 'waiting' && open.has(view.task)).sort((a, b) => since(a) - since(b))
}

export function checkpointHandoffs(rows: TaskSession[]): number {
  return rows.filter((row) => row.how === 'checkpoint').length
}

export function taskProject(task: string): string {
  return task.replace(/-\d+$/, '')
}

export function chainProgress(tasks: HulyTask[]): { done: number; total: number } {
  const counted = tasks.filter((task) => task.status.category !== 'Lost')
  return { done: counted.filter((task) => task.status.category === 'Won').length, total: counted.length }
}

export function openQuestions(tasks: HulyTask[]): number {
  return tasks.filter((task) => task.question && isOpen(task.status)).length
}

export function chainStatus(chain: EvenKeelState['chain'], project: string): ChainStatus {
  const { active, queue } = chain
  if (active?.project === project) {
    return active.paused ? { kind: 'paused', error: active.error } : { kind: 'running', limitUntil: active.limitUntil ?? null }
  }
  const index = queue.indexOf(project)
  return index < 0 ? { kind: 'idle' } : { kind: 'queued', position: index + 1 }
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
      text: `Лимиты из /usage не читаются — показаны последние из statusline, CLI мог поменять формат. Причина: ${health.reason}`,
      key: `unread:${health.since}`,
    }
  }
  if (health.state === 'off') {
    return {
      tone: 'error',
      text: `Опрос /usage выключен до перезапуска службы: ответ похож на ход модели, а он тратит квоту. Причина: ${health.reason}`,
      key: `off:${health.since}`,
    }
  }
  return null
}

export function limitWaitText(until: string, now: Date): string {
  return `Лимит исчерпан — следующая задача запустится после сброса в ${formatMoment(until, now)}.`
}

export function cardTask(state: EvenKeelState, project: string): CardTask | null {
  const active = state.chain.active
  const current = active?.project === project ? active.current?.task : undefined
  const order = state.chain.projects[project]?.order ?? []
  const id = current ?? nextTask(projectTasks(state, project), order, state.chain.skipped[project] ?? [])
  if (id === undefined) return null
  const session = taskSession(state.sessions, id)
  return {
    id,
    title: state.tasks.find((task) => task.id === id)?.title ?? null,
    lamp: session?.lamp ?? 'idle',
    next: current === undefined,
  }
}

export function projectSlot(projects: string[], project: string): number | null {
  const index = projects.indexOf(project)
  return index < 0 || index >= PROJECT_SLOTS ? null : index + 1
}

export function chainBlocks(state: EvenKeelState, project: string): ChainBlock[] {
  const tasks = projectTasks(state, project)
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const closed = tasks.filter((task) => !isOpen(task.status))
  const after = precedence(tasks.filter((task) => isOpen(task.status)))
  const order = state.chain.projects[project]
  const open =
    order === undefined || order.error !== null
      ? tasks.filter((task) => isOpen(task.status)).map((task) => task.id).sort(byNumber)
      : order.order
  const active = state.chain.active
  const current = active?.project === project ? active.current?.task : undefined
  const hold = active?.project === project ? active.current?.limit : undefined
  const pending = hold !== undefined && hold.acted === null ? hold : null
  const skipped = new Set(state.chain.skipped[project] ?? [])

  return [...closedOrder(closed, state.taskSessions), ...open].map((id) => {
    const task = byId.get(id)
    const session = taskSession(state.sessions, id) ?? null
    return {
      id,
      title: task?.title ?? null,
      status: task?.status.name ?? null,
      lamp: blockLamp(task, session),
      open: task !== undefined && isOpen(task.status),
      blockedBy: task?.blockedBy ?? [],
      milestone: task?.milestone?.label ?? null,
      after: after.get(id) ?? [],
      current: id === current,
      skipped: skipped.has(id),
      question: task?.question ?? false,
      session,
      sessions: state.taskSessions[id] ?? [],
      limit: id === current ? pending : null,
    }
  })
}

export function contextFill(tokens: number, scale: ContextScale): { percent: number; level: ContextLevel } {
  const percent = Math.min(100, (tokens / scale.window) * 100)
  const level = percent >= scale.danger ? 'danger' : percent >= scale.warn ? 'warn' : 'ok'
  return { percent, level }
}

export function queuedAfter(chain: EvenKeelState['chain'], project: string): string | null {
  const index = chain.queue.indexOf(project)
  if (index < 0) return null
  return index === 0 ? (chain.active?.project ?? null) : chain.queue[index - 1]!
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

export function tokenTotal(tokens: TokenTotals): number {
  return tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite
}

export function issueLink(trackerUrl: string | null, task: string): string | null {
  return trackerUrl === null ? null : trackerUrl + task
}

function taskSession(sessions: SessionView[], task: string): SessionView | undefined {
  const own = sessions.filter((view) => view.task === task)
  return own.find((view) => view.lamp !== 'finished') ?? own.at(-1)
}

function closedOrder(tasks: HulyTask[], runs: Record<string, TaskSession[]>): string[] {
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

function blockLamp(task: HulyTask | undefined, session: SessionView | null): BlockLamp {
  if (task?.status.category === 'Won') return 'done'
  if (task?.status.category === 'Lost') return 'canceled'
  if (session === null) return 'ahead'
  return session.lamp === 'finished' ? 'stopped' : session.lamp
}
