import { isProvider } from '../agent/providers.js'

export type StatusCategory = 'UnStarted' | 'ToDo' | 'Active' | 'Won' | 'Lost'

export interface TaskStatus {
  name: string
  category: StatusCategory
}

export interface TaskMilestone {
  label: string
  targetDate: number | null
}

/** A milestone a task can be put into from its card; `id` is the tracker's own. */
export interface MilestoneChoice extends TaskMilestone {
  id: string
}

/** The milestones a task can be put into, and the one it is in (`TaskSource.milestones`). */
export interface MilestonePick {
  /** The id of the task's milestone; `null` — it has none. */
  current: string | null
  choices: MilestoneChoice[]
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
  /** What the task's run labels ask its sessions to run on; the chain reads them only where `modelLabels` is on. */
  runLabels: RunLabel[]
}

/** A label `<provider> | <model>`, or a bare `<provider>` that leaves the model to the config. */
export interface RunLabel {
  provider: string
  /** As written, for the CLI: a typo is the session's error on its first turn. */
  model: string | null
}

const RUN_LABEL = /^([^|]+?)\s*(?:\|\s*(.*?))?$/

/** The run label a task's label is, or `null` for a label of no known provider. */
export function runLabelOf(label: string): RunLabel | null {
  const match = RUN_LABEL.exec(label.trim())
  if (match === null) return null
  const provider = match[1]!.toLowerCase()
  const model = match[2]
  if (!isProvider(provider) || model === '') return null
  return { provider, model: model ?? null }
}

/** The label as the user would write it: `Claude | opus`, `Codex`. */
export function runLabelText({ provider, model }: RunLabel): string {
  const name = `${provider.charAt(0).toUpperCase()}${provider.slice(1)}`
  return model === null ? name : `${name} | ${model}`
}

export const QUESTION_LABELS = ['Question', 'Вопрос']
/** A task the user runs themselves: never in the chain, whatever `chain.excludedLabels` says. */
export const MANUAL_LABELS = ['Manual', 'Вручную']

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
    runLabels: runLabelsOf([...labels.values()]),
  }
}

function runLabelsOf(labels: string[]): RunLabel[] {
  const found = new Map<string, RunLabel>()
  for (const label of labels) {
    const run = runLabelOf(label)
    if (run !== null) found.set(`${run.provider}|${run.model ?? ''}`, run)
  }
  return [...found.values()]
}

export function parseTaskId(id: string): { project: string; number: number } | null {
  const match = /^([A-Z][A-Z0-9_]*)-([1-9]\d*)$/.exec(id)
  return match === null ? null : { project: match[1]!, number: Number(match[2]) }
}

/** The task's link by its project's template (`TrackerSetup.issueUrl`), as the page fills it. */
export function issueLink(template: string | null, task: string): string | null {
  const parsed = parseTaskId(task)
  return template === null || parsed === null ? null : template.replaceAll('{id}', task).replaceAll('{number}', String(parsed.number))
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
