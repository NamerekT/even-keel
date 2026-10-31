import { compareMilestones } from '../chain/order.js'
import { excludedOf, missingLabel, requiredOn, sameName, type ChainRules } from '../chain/rules.js'
import { QUESTION_LABELS, runLabelOf, type MilestonePick, type TaskMilestone, type TaskPriority, type TaskStatus } from './model.js'

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
  attachments: TaskAttachment[]
}

/** A file attached to the task or to one of its comments. */
export interface TaskAttachment {
  /** Unique within the task: the page asks the service for the file by it. */
  file: string
  name: string
  /** MIME type; empty when the tracker does not say. */
  type: string
  /** bytes; 0 when the tracker does not say */
  size: number
  /** A link the browser opens itself; `null` — the file goes through the service (`TaskSource.file`). */
  url: string | null
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

export interface TaskCard extends Omit<TrackerCard, 'labels' | 'attachments'> {
  labels: CardLabel[]
  attachments: (TaskAttachment & { url: string })[]
  /** "Into the chain" has something to do: move the `UnStarted` task to `ToDo`, or put the missing required label on. */
  ready: boolean
  /** "To the backlog" has something to do: move the `ToDo` or `Active` task back, or take the required labels off. */
  unready: boolean
  /** The labels the chain requires when the task has none of them; empty otherwise. */
  requires: string[]
  /** What the card's milestone can be changed to, in the chain's order; `null` — the tracker cannot move a task. */
  milestones: MilestonePick | null
}

/** What the task's connected tracker can do to move a task between the backlog and the chain. */
export interface TrackerMoves {
  ready: boolean
  unready: boolean
  relabel: boolean
}

export function cardOf(raw: TrackerCard, rules: ChainRules, can: TrackerMoves, milestones: MilestonePick | null = null): TaskCard {
  const labels = raw.labels.map((name) => ({ name, role: roleOf(name, rules) }))
  const required = rules.requiredLabels.length > 0 && !labels.some((label) => label.role === 'required')
  const { category } = raw.status
  const open = category !== 'Won' && category !== 'Lost'
  return {
    ...raw,
    labels,
    attachments: raw.attachments.map((each) => ({
      ...each,
      url: each.url ?? `/api/tasks/${encodeURIComponent(raw.id)}/files/${encodeURIComponent(each.file)}`,
    })),
    ready: (can.ready && category === 'UnStarted') || (can.relabel && missingLabel(rules, raw) !== null),
    unready: (can.unready && (category === 'ToDo' || category === 'Active')) || (can.relabel && open && requiredOn(rules, raw).length > 0),
    requires: required ? rules.requiredLabels : [],
    milestones: milestones === null ? null : { ...milestones, choices: [...milestones.choices].sort(compareMilestones) },
  }
}

function roleOf(label: string, rules: ChainRules): LabelRole | null {
  const listed = (names: string[]) => names.some((name) => sameName(name, label))
  if (listed(excludedOf(rules))) return 'excluded'
  if (listed(rules.requiredLabels)) return 'required'
  if (listed(QUESTION_LABELS)) return 'question'
  return runLabelOf(label) === null ? null : 'model'
}
