export type StatusCategory = 'UnStarted' | 'ToDo' | 'Active' | 'Won' | 'Lost'

export interface TaskStatus {
  name: string
  category: StatusCategory
}

export interface TaskMilestone {
  label: string
  targetDate: number | null
}

export const PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none'] as const
export type TaskPriority = (typeof PRIORITIES)[number]

export interface TrackerTask {
  id: string
  title: string
  status: TaskStatus
  blockedBy: string[]
  parent: string | null
  subtasks: number
  milestone: TaskMilestone | null
  priority: TaskPriority
  labels: string[]
  estimate: number | null
}

export interface Task extends TrackerTask {
  question: boolean
  models: ModelAlias[]
}

export const MODEL_ALIASES = ['sonnet', 'opus', 'haiku'] as const
export type ModelAlias = (typeof MODEL_ALIASES)[number]

export function isModelAlias(value: string): value is ModelAlias {
  return (MODEL_ALIASES as readonly string[]).includes(value)
}

export const QUESTION_LABELS = ['Question', 'Вопрос']

export interface StatusChange {
  id: string
  from: TaskStatus | null
  to: TaskStatus | null
}

export function toTask(raw: TrackerTask): Task {
  const labels = new Map<string, string>()
  for (const label of raw.labels) {
    const key = label.trim().toLocaleLowerCase()
    if (key !== '' && !labels.has(key)) labels.set(key, label.trim())
  }
  return {
    ...raw,
    labels: [...labels.values()],
    question: QUESTION_LABELS.some((label) => labels.has(label.toLocaleLowerCase())),
    models: MODEL_ALIASES.filter((model) => labels.has(model)),
  }
}

export function parseTaskId(id: string): { project: string; number: number } | null {
  const match = /^([A-Z][A-Z0-9_]*)-([1-9]\d*)$/.exec(id)
  return match === null ? null : { project: match[1]!, number: Number(match[2]) }
}

export function isLeaf(task: TrackerTask): boolean {
  return task.subtasks === 0
}

export function isOpen(status: TaskStatus): boolean {
  return status.category !== 'Won' && status.category !== 'Lost'
}

export function diffStatuses(
  known: ReadonlyMap<string, TaskStatus>,
  current: Task[],
  watched: string[],
): StatusChange[] {
  const now = new Map(current.map((task) => [task.id, task.status]))
  const changes: StatusChange[] = []
  for (const id of watched) {
    const from = known.get(id) ?? null
    const to = now.get(id) ?? null
    if (from?.name === to?.name && from?.category === to?.category) continue
    changes.push({ id, from, to })
  }
  return changes
}
