import type { Transaction } from '@electric-sql/pglite'
import type { Db } from '../storage/database.js'
import { writingAuthor } from '../tracker/author.js'
import type { ChangeAuthor, ChangeField, DiffLine, TaskChange } from '../tracker/history.js'

/** Who a store's writes are recorded as when nobody says: Even Keel itself. */
export const SERVICE_AUTHOR: ChangeAuthor = { by: 'service', model: null }

/** One field's change as `builtin_history` keeps it; `after` of a description is JSON of its difference. */
export interface HistoryRow {
  field: ChangeField
  before: string | null
  after: string | null
}

/** A change of a milestone of the built-in tracker (BTN-1112): its creation, its date (`String` of ms). */
export interface MilestoneChange {
  at: string
  by: ChangeAuthor['by']
  model: string | null
  field: 'created' | 'date'
  from: string | null
  to: string | null
}

/** The author of a write: the tasks server's call names its agent (`writingAs`); otherwise `fallback`. */
type Writer = [ChangeAuthor['by'], string | null, string | null]

export function writerOf(fallback: ChangeAuthor): Writer {
  const author = writingAuthor() ?? fallback
  return [author.by, author.by === 'agent' ? author.model : null, author.name ?? null]
}

export async function logTask(tx: Transaction, at: string, writer: Writer, row: { id: string; project_id: string }, changes: HistoryRow[]): Promise<void> {
  for (const change of changes) {
    await tx.query(
      'insert into builtin_history (project_id, task_id, at, author, model, author_name, field, before, after) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [row.project_id, row.id, at, ...writer, change.field, change.before, change.after],
    )
  }
}

export async function logMilestone(tx: Transaction, at: string, writer: Writer, project: string, milestone: string, field: MilestoneChange['field'], before: string | null, after: string | null): Promise<void> {
  await tx.query(
    'insert into builtin_history (project_id, milestone_id, at, author, model, author_name, field, before, after) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [project, milestone, at, ...writer, field, before, after],
  )
}

/** The task's changes by its row id, oldest first. */
export async function taskHistory(db: Db, task: string): Promise<TaskChange[]> {
  const { rows } = await db.query<HistoryRow & { at: string; author: ChangeAuthor['by']; author_name: string | null; model: string | null }>(
    'select at, author, author_name, model, field, before, after from builtin_history where task_id = $1 order by id',
    [task],
  )
  return rows.map((each) => ({
    at: Date.parse(each.at),
    by: each.author,
    ...(each.author_name === null ? {} : { name: each.author_name }),
    model: each.model,
    field: each.field,
    ...(each.field === 'description' ? { from: null, to: null, diff: JSON.parse(each.after ?? '[]') as DiffLine[] } : { from: each.before, to: each.after }),
  }))
}

/** The milestone's changes, oldest first. */
export async function milestoneHistory(db: Db, milestone: string): Promise<MilestoneChange[]> {
  const { rows } = await db.query<{ at: string; author: ChangeAuthor['by']; model: string | null; field: MilestoneChange['field']; before: string | null; after: string | null }>(
    'select at, author, model, field, before, after from builtin_history where milestone_id = $1 order by id',
    [milestone],
  )
  return rows.map((row) => ({ at: row.at, by: row.author, model: row.model, field: row.field, from: row.before, to: row.after }))
}
