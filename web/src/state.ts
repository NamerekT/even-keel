import { isOpen, type HulyTask } from '../../src/huly/model.js'
import type { Lamp } from '../../src/sessions/agents.js'
import type { BatonState, SessionView } from '../../src/state.js'

export type CardLamp = Lamp | 'idle'

export type ChainStatus =
  | { kind: 'running' }
  | { kind: 'paused'; error: string | null }
  | { kind: 'queued'; position: number }
  | { kind: 'idle' }

export interface CardTask {
  id: string
  title: string | null
  lamp: CardLamp
  next: boolean
}

export const PROJECT_SLOTS = 8

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
  if (active?.project === project) return active.paused ? { kind: 'paused', error: active.error } : { kind: 'running' }
  const index = queue.indexOf(project)
  return index < 0 ? { kind: 'idle' } : { kind: 'queued', position: index + 1 }
}

export function cardTask(state: BatonState, project: string): CardTask | null {
  const active = state.chain.active
  const current = active?.project === project ? active.current?.task : undefined
  const id = current ?? state.chain.projects[project]?.order[0]
  if (id === undefined) return null
  const sessions = state.sessions.filter((view) => view.task === id)
  const session = sessions.find((view) => view.lamp !== 'finished') ?? sessions.at(-1)
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
