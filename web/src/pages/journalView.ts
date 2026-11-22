import type { TaskRun } from '../../../src/sessions/runs.js'
import type { TaskComment } from '../../../src/tracker/card.js'
import { groupChanges, type ChangeField, type ChangeGroup, type TaskChange } from '../../../src/tracker/history.js'

/** How many of the latest entries a long journal shows before "N more". */
export const JOURNAL_SHOWN = 20

/** The entries the newest first (BTN-1451); `hidden` — how many older ones stay folded under "N more". */
export function journalWindow<T extends { at: number }>(entries: T[], all: boolean): { shown: T[]; hidden: number } {
  const sorted = [...entries].sort((a, b) => b.at - a.at)
  const hidden = all ? 0 : Math.max(0, sorted.length - JOURNAL_SHOWN)
  return { shown: sorted.slice(0, sorted.length - hidden), hidden }
}

/** The replies in a comment's thread (BTN-909), the oldest first; never folded. */
export function repliesOf(comment: TaskComment): TaskComment[] {
  return [...(comment.replies ?? [])].sort((a, b) => a.at - b.at)
}

export interface AuthorTexts {
  you: string
  agent: string
  service: string
  noAuthor: string
}

/** The person reads their own notes as "You"; an agent's model is a tag of its own next to the name (`journalModel`). */
export function journalAuthor(comment: TaskComment, texts: AuthorTexts): string {
  const journal = comment.journal
  if (journal === undefined) return comment.author ?? texts.noAuthor
  return changeAuthor(journal.by, texts)
}

export function changeAuthor(by: 'person' | 'agent' | 'service', texts: Omit<AuthorTexts, 'noAuthor'>): string {
  return by === 'person' ? texts.you : by === 'service' ? texts.service : texts.agent
}

/**
 * The run tag of an agent's model as the journal keeps it, `<Provider> | <model>` (`Claude | opus`); `null` — no model
 * or a text of another shape.
 */
export function journalModel(model: string | null | undefined): TaskRun | null {
  if (model == null) return null
  const split = model.indexOf(' | ')
  if (split <= 0) return null
  return { provider: model.slice(0, split).trim().toLowerCase(), model: model.slice(split + 3).trim() || null, effort: null }
}

/** Which entries the journal shows (BTN-1112). */
export type JournalFilter = 'all' | 'comments' | 'changes'

export type JournalItem = { kind: 'comment'; at: number; comment: TaskComment } | { kind: 'changes'; at: number; group: ChangeGroup }

/**
 * The comments and the task's changes in one stream by time: one author's close changes are one entry, never across a
 * comment (`groupChanges`). The filter keeps one kind; the journal's window counts what it keeps.
 */
export function journalItems(comments: TaskComment[], history: readonly TaskChange[], filter: JournalFilter): JournalItem[] {
  const notes: JournalItem[] = filter === 'changes' ? [] : comments.map((comment) => ({ kind: 'comment', at: comment.at, comment }))
  const changes: JournalItem[] = filter === 'comments' ? [] : groupChanges(history, comments.map((each) => each.at)).map((group) => ({ kind: 'changes', at: group.at, group }))
  return [...notes, ...changes].sort((a, b) => a.at - b.at)
}

/** The fields one row gathers every change of, as chips: added and removed labels and links. */
const LISTS: ReadonlySet<ChangeField> = new Set(['label', 'blocks', 'blockedBy', 'relates', 'subtask'])

/** One row of a change entry's table: a field and its changes, several only for a list field. */
export interface ChangeRow {
  field: ChangeField
  changes: TaskChange[]
}

/** A group's rows in the order the fields first changed; a list field's changes in one row. */
export function changeRows(group: ChangeGroup): ChangeRow[] {
  const rows: ChangeRow[] = []
  for (const change of group.changes) {
    const row = LISTS.has(change.field) ? rows.find((each) => each.field === change.field) : undefined
    if (row === undefined) rows.push({ field: change.field, changes: [change] })
    else row.changes.push(change)
  }
  return rows
}

/** The run a `run` change keeps as its JSON; `null` — none (as the project says) or a text it cannot read. */
export function changeRun(text: string | null): TaskRun | null {
  if (text === null) return null
  try {
    const run = JSON.parse(text) as Partial<TaskRun>
    return { provider: run.provider ?? null, model: run.model ?? null, effort: run.effort ?? null }
  } catch {
    return null
  }
}
