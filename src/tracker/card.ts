import { milestoneComparator } from '../chain/order.js'
import { entryLabels, missingLabel, requiredOn, sameName, type ChainRules } from '../chain/rules.js'
import { QUESTION_LABELS, type MilestonePick, type TaskMilestone, type TaskPriority, type TaskStatus } from './model.js'

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
  /** Minutes of the agent's active work, where the tracker keeps an estimate (BTN-893); absent or `null` — none. */
  estimate?: number | null
  /** Opened by an outsider, as `TrackerTask.outsider` (BTN-1123). */
  outsider?: true
  /** Who opened it, given with `outsider` (BTN-1124): `task_read` says whose the text is; `null` — a deleted account. */
  author?: string | null
  /** Only the tracker kept in Even Keel itself (the built-in one) gives it: the card is where its tasks are edited. */
  edit?: CardEdit
}

/** A subtask as its parent's card lists it. */
export interface SubtaskRef extends TaskRef {
  milestone: string | null
}

/** What the card of a task Even Keel keeps itself offers to edit it with (BTN-771). */
export interface CardEdit {
  statuses: TaskStatus[]
  /** The project's labels and the built-in ones (`builtin`: Even Keel gives them a meaning). */
  labels: { name: string; builtin: boolean }[]
  /** The root first, the direct parent last. */
  ancestors: TaskRef[]
  subtasks: SubtaskRef[]
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
  /** The file's absolute path on this machine: only the built-in tracker gives it, for sessions to read (BTN-773). */
  path?: string
  /** The record outlived its file: the card says so instead of a picture. */
  missing?: true
  /** The attachment's record, by which the card deletes it; only the built-in tracker gives it. */
  id?: string
  /** Only comments of outsiders (`TaskComment.outsider`) carry the file: the page shows it, `task_read` neither lists nor downloads it. */
  outsider?: true
}

export interface TaskRef {
  id: string
  title: string
  status: TaskStatus
  /** A built-in task copied into another tracker (BTN-1073): its new task there; `url` — `null` where the tracker gives none. */
  moved?: TaskMoved
}

export interface TaskMoved {
  key: string
  url: string | null
}

export interface TaskComment {
  /** `null` — the tracker does not say who wrote it. */
  author: string | null
  /** ms */
  at: number
  text: string
  /** The replies in the comment's thread, oldest first; only a tracker with threads under comments gives them (Huly). */
  replies?: TaskComment[]
  /**
   * A public tracker's comment by someone the adapter does not trust, by the rule of its `commentsAfter` (BTN-1122):
   * the page shows it, `task_read` hides its text from the session. Huly, Linear and Jira never set it: a guest there is invited.
   */
  outsider?: true
  /** Only the built-in tracker's journal (BTN-774) gives the rest. */
  journal?: JournalEntry
}

/** Who wrote a comment of the built-in tracker's journal, and what the card may do with it. */
export interface JournalEntry {
  id: string
  by: 'person' | 'agent' | 'service'
  /** `<Provider> | <model>` of an agent's session; `null` — not an agent, or not known. */
  model: string | null
}

/** What a label means to Even Keel: picks the model, marks a question, keeps the task out of the chain or lets it in. */
export type LabelRole = 'question' | 'excluded' | 'required'

export interface CardLabel {
  name: string
  role: LabelRole | null
}

export interface TaskCard extends Omit<TrackerCard, 'labels' | 'attachments' | 'edit'> {
  labels: CardLabel[]
  /** `null` — the card only shows the task; its tracker is where it is edited. */
  edit: (CardEdit & { milestoneRules: Pick<ChainRules, 'requiredMilestones' | 'excludedMilestones'> }) | null
  attachments: (TaskAttachment & { url: string })[]
  /** "Into the chain" has something to do: move the `UnStarted` task to `ToDo`, or put the missing required label on. */
  ready: boolean
  /** "To the backlog" has something to do: move the `ToDo` or `Active` task back, or take the required labels off. */
  unready: boolean
  /** The labels the chain requires when the task has none of them; empty otherwise. */
  requires: string[]
  /** What the card's milestone can be changed to, in the chain's order; `null` — the tracker cannot move a task. */
  milestones: MilestonePick | null
  /** The tracker can write the task's labels. */
  relabel: boolean
  /** The agent's active seconds on the task from Tally, added by the service (BTN-1097); absent or `null` — not known. */
  activeS?: number | null
}

/** What the task's connected tracker can do to move a task between the backlog and the chain. */
export interface TrackerMoves {
  ready: boolean
  unready: boolean
  relabel: boolean
}

export function cardOf(raw: TrackerCard, rules: ChainRules, can: TrackerMoves, milestones: MilestonePick | null = null): TaskCard {
  const entry = entryLabels(rules, raw)
  const labels = raw.labels.map((name) => ({ name, role: roleOf(name, rules, entry) }))
  const required = entry.length > 0 && !labels.some((label) => label.role === 'required')
  const { category } = raw.status
  const open = category !== 'Won' && category !== 'Lost'
  const { edit, ...rest } = raw
  return {
    ...rest,
    labels,
    edit: edit === undefined ? null : { ...edit, milestoneRules: { requiredMilestones: rules.requiredMilestones, excludedMilestones: rules.excludedMilestones } },
    attachments: raw.attachments.map((each) => ({
      ...each,
      url: each.url ?? `/api/tasks/${encodeURIComponent(raw.id)}/files/${encodeURIComponent(each.file)}`,
    })),
    ready: (can.ready && category === 'UnStarted') || (can.relabel && missingLabel(rules, raw) !== null),
    unready: (can.unready && (category === 'ToDo' || category === 'Active')) || (can.relabel && open && requiredOn(rules, raw).length > 0),
    requires: required ? entry : [],
    milestones: milestones === null ? null : { ...milestones, choices: [...milestones.choices].sort(milestoneComparator(milestones.choices)) },
    relabel: can.relabel,
  }
}

function roleOf(label: string, rules: ChainRules, entry: string[]): LabelRole | null {
  const listed = (names: string[]) => names.some((name) => sameName(name, label))
  if (listed(rules.excludedLabels)) return 'excluded'
  if (listed(entry)) return 'required'
  if (listed(QUESTION_LABELS)) return 'question'
  return null
}
