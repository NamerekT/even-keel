import { isProvider } from '../agent/providers.js'

export type StatusCategory = 'UnStarted' | 'ToDo' | 'Active' | 'Won' | 'Lost'

export interface TaskStatus {
  name: string
  category: StatusCategory
}

export interface TaskMilestone {
  label: string
  targetDate: number | null
  /** A position within one tracker project's ordered catalog; never comparable across sources. */
  trackerOrder?: { source: string; value: number }
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
  /**
   * Opened by someone who is not one of the repository's own people, by the comments' trust rule (BTN-1123: GitHub,
   * GitLab, Forgejo, in `chainTasks` and `editor.list`). Such a task enters the chain only with an entry label
   * (`entryLabels`), and without one the tasks tools give none of its text (BTN-1125).
   */
  outsider?: true
  /** Set on an outsider's task whose author changed its title or description (BTN-1124); absent — never changed. */
  edited?: TextEdit
}

/**
 * When an outsider last changed a task's title or description and when its labels were put on (BTN-1124): a label is a
 * person's word on the text it was put on, so a later change keeps the task out until the label goes on again.
 */
export interface TextEdit {
  /** ms of the last change by the task's author (or a deleted account). */
  at: number
  /** Each putting of a label the tracker gave, as it spells the label; ms. */
  labeled: { label: string; at: number }[]
}

export interface Task extends TrackerTask {
  question: boolean
}

/** A task with subtasks as the page's "Parents" view shows it (BTN-1041). */
export interface ParentTask extends Task {
  /** Its direct subtasks that are closed: all of them less the open ones the read gave. */
  closedSubtasks: number
}

/**
 * A label `<provider> | <model>`, or a bare `<provider>` that leaves the model to the config. The chain read such
 * labels until BTN-983; now they are only moved once into the tasks' runs (`TaskRuns.importLabels`).
 */
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
  }
}

export function parseTaskId(id: string): { project: string; number: number } | null {
  const match = /^([A-Z][A-Z0-9_]*)-([1-9]\d*)$/.exec(id)
  return match === null ? null : { project: match[1]!, number: Number(match[2]) }
}

/** A time entry's hours in whole minutes, at least one: what a tracker's time tracking takes (`TaskSource.logTime`). */
export function entryMinutes(hours: number): number {
  return Math.max(1, Math.round(hours * 60))
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

/** The statuses in their order, a name once whatever its case: the first one of a name stays (`TaskSource.statuses`). */
export function uniqueStatuses(statuses: readonly TaskStatus[]): TaskStatus[] {
  const seen = new Map<string, TaskStatus>()
  for (const status of statuses) {
    const key = status.name.trim().toLocaleLowerCase()
    if (!seen.has(key)) seen.set(key, status)
  }
  return [...seen.values()]
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
