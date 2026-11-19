import { randomUUID } from 'node:crypto'
import type { Transaction } from '@electric-sql/pglite'
import { fail } from '../notice/notice.js'
import type { Db } from '../storage/database.js'
import { isOpen } from '../tracker/model.js'
import type { Stamp } from './components.js'
import { lineDiff } from './diff.js'
import { logMilestone, logTask, type MilestoneChange } from './history-log.js'
import { builtinStatus, compareBuiltinMilestones } from './model.js'

/** A milestone's status (BTN-1287): what the page shows; the chain never reads it. */
export const MILESTONE_STATUSES = ['planned', 'active', 'completed', 'canceled'] as const
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number]

/** "Completed" and "Canceled": the milestone has a closing time and sits among the closed ones. */
export const isClosedMilestone = (status: MilestoneStatus): boolean => status === 'completed' || status === 'canceled'

/** A milestone of a built-in project as the tracker window lists it. */
export interface BuiltinMilestoneRow {
  id: string
  name: string
  /** The target date, ms; `null` — none. */
  date: number | null
  /** Markdown; empty — none. */
  description: string
  status: MilestoneStatus
  /** When it was completed or canceled, ISO; `null` — it is open. */
  closedAt: string | null
  /** ISO; `null` — made before the milestones had a time. */
  createdAt: string | null
  /** Its tasks not closed yet, and all of them. */
  open: number
  total: number
  /** The numbers of its open tasks. */
  openTasks: number[]
}

export interface MilestoneFields {
  name: string
  description: string
  status: MilestoneStatus
  date: number | null
}

/**
 * What a write that renames or deletes a milestone tells the rest of Even Keel, inside the write's transaction: a throw
 * undoes the write. `to` `null` — the milestone is deleted.
 */
export type MilestoneRenamed = (from: string, to: string | null) => void

interface MilestoneDbRow {
  id: string
  name: string
  date: number | null
  description: string
  status: MilestoneStatus
  closed_at: string | null
  created_at: string | null
}

const COLUMNS = 'id, name, date::float8 as date, description, status, closed_at, created_at'

/** The project's milestones by date, the undated after them, then by name; each with its task counts. */
export async function listMilestones(db: Db, project: string): Promise<BuiltinMilestoneRow[]> {
  const { rows } = await db.query<MilestoneDbRow>(`select ${COLUMNS} from builtin_milestones where project_id = $1`, [project])
  const { rows: tasks } = await db.query<{ milestone_id: string; status: string; number: number }>(
    'select milestone_id, status, number from builtin_tasks where project_id = $1 and milestone_id is not null order by number',
    [project],
  )
  const open = (status: string) => isOpen(builtinStatus(status) ?? { name: status, category: 'UnStarted' })
  return rows.sort(compareBuiltinMilestones).map((row) => {
    const mine = tasks.filter((each) => each.milestone_id === row.id)
    const openTasks = mine.filter((each) => open(each.status)).map((each) => each.number)
    return {
      id: row.id, name: row.name, date: row.date, description: row.description, status: row.status, closedAt: row.closed_at, createdAt: row.created_at,
      open: openTasks.length, total: mine.length, openTasks,
    }
  })
}

/** Creates the milestone (`id` `null`) or changes it; returns its id. A new name goes to `renamed` inside the write. */
export async function saveMilestone(tx: Transaction, stamp: Stamp, project: string, id: string | null, fields: MilestoneFields, renamed?: MilestoneRenamed): Promise<string> {
  const name = nameOf(fields.name)
  const { rows: same } = await tx.query<{ id: string }>('select id from builtin_milestones where project_id = $1 and lower(name) = lower($2)', [project, name])
  if (same.some((each) => each.id !== id)) throw fail('builtin.milestoneTaken', { name })
  const closedAt = isClosedMilestone(fields.status) ? stamp.at : null
  if (id === null) {
    const made = randomUUID()
    await tx.query(
      'insert into builtin_milestones (id, project_id, name, date, description, status, closed_at, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)',
      [made, project, name, fields.date, fields.description, fields.status, closedAt, stamp.at],
    )
    const log = (change: Omit<MilestoneChange, 'at' | 'by' | 'model'>) => logMilestone(tx, stamp.at, stamp.writer, project, made, change.field, change.from, change.to)
    await log({ field: 'created', from: null, to: name })
    await logChanges(log, { name, description: '', status: 'planned', date: null }, { ...fields, name })
    return made
  }
  const was = await rowOf(tx, project, id)
  const keptClosed = isClosedMilestone(fields.status) && isClosedMilestone(was.status) ? was.closed_at : closedAt
  await tx.query(
    'update builtin_milestones set name = $2, date = $3, description = $4, status = $5, closed_at = $6 where id = $1',
    [id, name, fields.date, fields.description, fields.status, keptClosed],
  )
  const log = (change: Omit<MilestoneChange, 'at' | 'by' | 'model'>) => logMilestone(tx, stamp.at, stamp.writer, project, id, change.field, change.from, change.to)
  await logChanges(log, { name: was.name, description: was.description, status: was.status, date: was.date }, { ...fields, name })
  if (was.name !== name) renamed?.(was.name, name)
  return id
}

/** The id of the project's milestone of this name, ignoring case; a name it lacks makes a new planned one. */
export async function milestoneIdOf(tx: Transaction, stamp: Stamp, project: string, name: string): Promise<string> {
  const trimmed = nameOf(name)
  const { rows } = await tx.query<{ id: string }>('select id from builtin_milestones where project_id = $1 and lower(name) = lower($2)', [project, trimmed])
  if (rows[0] !== undefined) return rows[0].id
  return saveMilestone(tx, stamp, project, null, { name: trimmed, description: '', status: 'planned', date: null })
}

/**
 * Deletes the milestone; its tasks go to the milestone `to` or to none, each recording the move. Refused while it has a
 * closed task: those keep what they were done in, so such a milestone is canceled instead. Its own history stays, its
 * deletion last; `renamed` gets its name inside the write. Returns the moved tasks' row ids.
 */
export async function removeMilestone(tx: Transaction, stamp: Stamp, project: string, id: string, to: string | null, renamed?: MilestoneRenamed): Promise<string[]> {
  const was = await rowOf(tx, project, id)
  const target = to === null ? null : to === id ? null : await rowOf(tx, project, to).catch(() => null)
  if (to !== null && target === null) throw fail('builtin.noMilestone', {})
  const { rows: tasks } = await tx.query<{ id: string; status: string }>('select id, status from builtin_tasks where milestone_id = $1', [id])
  const closed = tasks.filter((each) => !isOpen(builtinStatus(each.status) ?? { name: each.status, category: 'UnStarted' })).length
  if (closed > 0) throw fail('builtin.milestoneClosedTasks', { milestone: was.name, count: closed })
  await tx.query('update builtin_tasks set milestone_id = $2, version = version + 1, updated_at = $3 where milestone_id = $1', [id, to, stamp.at])
  for (const task of tasks) await logTask(tx, stamp.at, stamp.writer, { id: task.id, project_id: project }, [{ field: 'milestone', before: was.name, after: target?.name ?? null }])
  await tx.query('delete from builtin_milestones where id = $1', [id])
  await logMilestone(tx, stamp.at, stamp.writer, project, id, 'removed', was.name, null)
  renamed?.(was.name, null)
  return tasks.map((each) => each.id)
}

type Log = (change: Omit<MilestoneChange, 'at' | 'by' | 'model'>) => Promise<void>

async function logChanges(log: Log, was: MilestoneFields, now: MilestoneFields): Promise<void> {
  if (was.name !== now.name) await log({ field: 'name', from: was.name, to: now.name })
  if (was.description !== now.description) await log({ field: 'description', from: null, to: JSON.stringify(lineDiff(was.description, now.description)) })
  if (was.status !== now.status) await log({ field: 'status', from: was.status, to: now.status })
  if (was.date !== now.date) await log({ field: 'date', from: dateText(was.date), to: dateText(now.date) })
}

const dateText = (date: number | null) => (date === null ? null : String(date))

async function rowOf(tx: Transaction, project: string, id: string): Promise<MilestoneDbRow> {
  const { rows } = await tx.query<MilestoneDbRow>(`select ${COLUMNS} from builtin_milestones where id = $1 and project_id = $2`, [id, project])
  if (rows[0] === undefined) throw fail('builtin.noMilestone', {})
  return rows[0]
}

function nameOf(name: string): string {
  const trimmed = name.trim()
  if (trimmed === '') throw fail('builtin.emptyName', {})
  return trimmed
}
