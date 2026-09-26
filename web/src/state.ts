import { isOpen, type HulyTask } from '../../src/huly/model.js'
import type { BatonState, SessionView } from '../../src/state.js'

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
