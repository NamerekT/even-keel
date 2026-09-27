import type { AccountView } from '../../src/account/model.js'
import type { TaskSession } from '../../src/chain/launches.js'
import { chainOrder, nextTask, precedence } from '../../src/chain/order.js'
import type { LimitHold } from '../../src/chain/relay.js'
import { isOpen, type HulyTask } from '../../src/huly/model.js'
import type { Lamp } from '../../src/sessions/agents.js'
import type { TokenTotals } from '../../src/sessions/transcript.js'
import type { UsageHealth } from '../../src/limits/usage.js'
import type { BatonState, ContextScale, SessionView } from '../../src/state.js'
import { formatMoment } from './format.js'

export type CardLamp = Lamp | 'idle'

export interface AccountBadge {
  kind: 'in' | 'out' | 'login' | 'unknown'
  label: string
}

export function accountBadge(view: AccountView): AccountBadge {
  if (view.login !== null) return view.login.error === null ? { kind: 'login', label: 'Вход…' } : { kind: 'out', label: 'Вход не удался' }
  if (view.status === null) return { kind: 'unknown', label: 'Claude' }
  if (!view.status.loggedIn) return { kind: 'out', label: 'Не вошли' }
  return { kind: 'in', label: view.status.email?.split('@')[0] ?? 'Claude' }
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
  session: SessionView | null
  sessions: TaskSession[]
  limit: LimitHold | null
}

export type ContextLevel = 'ok' | 'warn' | 'danger'

export const PROJECT_SLOTS = 8

const byNumber = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true })

export function projectTasks(state: BatonState, project: string): HulyTask[] {
  return state.tasks.filter((task) => task.id.startsWith(`${project}-`))
}

export function waitingSessions(sessions: SessionView[], tasks: HulyTask[]): SessionView[] {
  const open = new Set(tasks.filter((task) => isOpen(task.status)).map((task) => task.id))
  const since = (view: SessionView) => Date.parse(view.lastActivityAt ?? view.startedAt)
  return sessions.filter((view) => view.lamp === 'waiting' && open.has(view.task)).sort((a, b) => since(a) - since(b))
}

export function taskProject(task: string): string {
  return task.replace(/-\d+$/, '')
}

export function chainProgress(tasks: HulyTask[]): { done: number; total: number } {
  const counted = tasks.filter((task) => task.status.category !== 'Lost')
  return { done: counted.filter((task) => task.status.category === 'Won').length, total: counted.length }
}

export function chainStatus(chain: BatonState['chain'], project: string): ChainStatus {
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

export function cardTask(state: BatonState, project: string): CardTask | null {
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

export function chainBlocks(state: BatonState, project: string): ChainBlock[] {
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

  return [...closedOrder(closed), ...open].map((id) => {
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

export function queuedAfter(chain: BatonState['chain'], project: string): string | null {
  const index = chain.queue.indexOf(project)
  if (index < 0) return null
  return index === 0 ? (chain.active?.project ?? null) : chain.queue[index - 1]!
}

export function sessionElapsed(view: SessionView, now: Date): number {
  const start = Date.parse(view.startedAt)
  const end = view.lamp === 'finished' ? Date.parse(view.lastActivityAt ?? view.startedAt) : now.getTime()
  return Math.max(0, end - start)
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

function closedOrder(tasks: HulyTask[]): string[] {
  try {
    return chainOrder(tasks)
  } catch {
    return tasks.map((task) => task.id).sort(byNumber)
  }
}

function blockLamp(task: HulyTask | undefined, session: SessionView | null): BlockLamp {
  if (task?.status.category === 'Won') return 'done'
  if (task?.status.category === 'Lost') return 'canceled'
  if (session === null) return 'ahead'
  return session.lamp === 'finished' ? 'stopped' : session.lamp
}
