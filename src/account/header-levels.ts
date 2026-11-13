import type { CurrentTask } from '../chain/model.js'
import { nextTask } from '../chain/order.js'
import { runChoice, type RunSettings } from '../sessions/launch.js'
import type { TaskRun } from '../sessions/runs.js'
import type { Task } from '../tracker/model.js'

export interface AccountLevel {
  account: string
  source: 'task' | 'project' | 'shared'
  task?: string
}

export interface HeaderContext {
  shared: RunSettings
  project: RunSettings
  tasks: Task[]
  order: string[]
  current: CurrentTask | null
  holding?: string[]
  /** The task's run (`TaskRuns`). */
  runOf: (task: string) => TaskRun | undefined
  sessionAccount: (sessionId: string) => string | undefined
  hasAccount: (provider: string, account: string) => boolean
}

/** The same launch choice as a session, with its inherited accounts underneath. No liveness or pause changes the choice. */
export function headerLevels(ctx: HeaderContext): AccountLevel[] {
  const shared = runChoice(undefined, ctx.shared, ctx.hasAccount).account
  const project = runChoice(undefined, ctx.project, ctx.hasAccount).account
  const open = (task: Task) => task.status.category !== 'Won' && task.status.category !== 'Lost'
  const current = ctx.tasks.find((task) => task.id === ctx.current?.task && open(task))
  const next = nextTask(ctx.tasks, ctx.order.filter((id) => ctx.tasks.some((task) => task.id === id && open(task))), ctx.holding ?? [])
  const task = current ?? ctx.tasks.find((each) => each.id === next)
  const run = task === undefined ? undefined : ctx.runOf(task.id)
  const choice = runChoice(run, ctx.project, ctx.hasAccount)
  const pinned = current && ctx.current?.sessionId ? ctx.sessionAccount(ctx.current.sessionId) : undefined
  const account = pinned ?? choice.account
  const labelled = (run?.provider ?? null) !== null && choice.fallback === null
  const levels: AccountLevel[] = []
  if (task && (labelled || account !== project)) levels.push({ account, source: 'task', task: task.id })
  if (project !== shared) levels.push({ account: project, source: 'project' })
  levels.push({ account: shared, source: 'shared' })
  return levels.filter((each, index) => levels.findIndex((other) => other.account === each.account) === index)
}
