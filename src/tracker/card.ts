import { sameName, type ChainRules } from '../chain/rules.js'
import { isModelAlias, QUESTION_LABELS, type TaskMilestone, type TaskPriority, type TaskStatus } from './model.js'

/** A task in full for its card on the page (`TaskSource.card`). `description` and comment texts are Markdown. */
export interface TrackerCard {
  id: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  labels: string[]
  milestone: TaskMilestone | null
  parent: TaskRef | null
  blockedBy: TaskRef[]
  blocks: TaskRef[]
  related: TaskRef[]
  comments: TaskComment[]
}

export interface TaskRef {
  id: string
  title: string
  status: TaskStatus
}

export interface TaskComment {
  /** `null` — the tracker does not say who wrote it. */
  author: string | null
  /** ms */
  at: number
  text: string
}

/** What a label means to Even Keel: picks the model, marks a question, keeps the task out of the chain or lets it in. */
export type LabelRole = 'model' | 'question' | 'excluded' | 'required'

export interface CardLabel {
  name: string
  role: LabelRole | null
}

export interface TaskCard extends Omit<TrackerCard, 'labels'> {
  labels: CardLabel[]
  /** The tracker can move the task to a `ToDo` status, and the task is `UnStarted`. */
  ready: boolean
  /** The labels the chain requires when the task has none of them; empty otherwise. */
  requires: string[]
}

export function cardOf(raw: TrackerCard, rules: ChainRules, canReady: boolean): TaskCard {
  const labels = raw.labels.map((name) => ({ name, role: roleOf(name, rules) }))
  const required = rules.requiredLabels.length > 0 && !labels.some((label) => label.role === 'required')
  return {
    ...raw,
    labels,
    ready: canReady && raw.status.category === 'UnStarted',
    requires: required ? rules.requiredLabels : [],
  }
}

function roleOf(label: string, rules: ChainRules): LabelRole | null {
  const listed = (names: string[]) => names.some((name) => sameName(name, label))
  if (listed(rules.excludedLabels)) return 'excluded'
  if (listed(rules.requiredLabels)) return 'required'
  if (listed(QUESTION_LABELS)) return 'question'
  return isModelAlias(label.trim().toLocaleLowerCase()) ? 'model' : null
}
