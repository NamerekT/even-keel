import { randomUUID } from 'node:crypto'
import type { Transaction } from '@electric-sql/pglite'
import { fail } from '../notice/notice.js'
import type { Db } from '../storage/database.js'
import { isOpen } from '../tracker/model.js'
import { lineDiff } from './diff.js'
import { logComponent, logTask, type Writer } from './history-log.js'
import { builtinStatus } from './model.js'

/** A component of a built-in project (BTN-1288): what part of it a task is about. The chain never reads it. */
export interface BuiltinComponent {
  id: string
  name: string
  /** Markdown; empty — none. */
  description: string
  createdAt: string
  /** Its tasks not closed yet, and all of them. */
  open: number
  total: number
}

export interface ComponentFields {
  name: string
  description: string
}

/** When and by whom a write is made: every change of it goes into the history so. */
export interface Stamp {
  at: string
  writer: Writer
}

/** The project's components by name, ignoring case. */
export async function listComponents(db: Db, project: string): Promise<BuiltinComponent[]> {
  const { rows } = await db.query<{ id: string; name: string; description: string; created_at: string }>(
    'select id, name, description, created_at from builtin_components where project_id = $1 order by lower(name), id',
    [project],
  )
  const { rows: tasks } = await db.query<{ component_id: string; status: string; count: number }>(
    `select component_id, status, count(*)::int as count from builtin_tasks
      where project_id = $1 and component_id is not null group by component_id, status`,
    [project],
  )
  return rows.map((row) => {
    const mine = tasks.filter((each) => each.component_id === row.id)
    const sum = (list: typeof mine) => list.reduce((total, each) => total + each.count, 0)
    const open = mine.filter((each) => isOpen(builtinStatus(each.status) ?? { name: each.status, category: 'UnStarted' }))
    return { id: row.id, name: row.name, description: row.description, createdAt: row.created_at, open: sum(open), total: sum(mine) }
  })
}

/** Creates the component (`id` `null`) or changes its name and description; returns its id. */
export async function saveComponent(tx: Transaction, stamp: Stamp, project: string, id: string | null, fields: ComponentFields): Promise<string> {
  const name = nameOf(fields.name)
  const { rows: same } = await tx.query<{ id: string }>('select id from builtin_components where project_id = $1 and lower(name) = lower($2)', [project, name])
  if (same.some((each) => each.id !== id)) throw fail('builtin.componentTaken', { name })
  if (id === null) {
    const made = randomUUID()
    await tx.query('insert into builtin_components (id, project_id, name, description, created_at) values ($1, $2, $3, $4, $5)', [made, project, name, fields.description, stamp.at])
    await logComponent(tx, stamp.at, stamp.writer, project, made, { field: 'created', from: null, to: name })
    return made
  }
  const was = await rowOf(tx, project, id)
  await tx.query('update builtin_components set name = $2, description = $3 where id = $1', [id, name, fields.description])
  if (was.name !== name) await logComponent(tx, stamp.at, stamp.writer, project, id, { field: 'name', from: was.name, to: name })
  if (was.description !== fields.description) {
    await logComponent(tx, stamp.at, stamp.writer, project, id, { field: 'description', from: null, to: JSON.stringify(lineDiff(was.description, fields.description)) })
  }
  return id
}

/** The id of the project's component of this name, ignoring case; `create` makes a new one, otherwise it is refused. */
export async function componentIdOf(tx: Transaction, stamp: Stamp, project: string, name: string, create = false): Promise<string> {
  const trimmed = nameOf(name)
  const { rows } = await tx.query<{ id: string }>('select id from builtin_components where project_id = $1 and lower(name) = lower($2)', [project, trimmed])
  if (rows[0] !== undefined) return rows[0].id
  if (!create) throw fail('builtin.noComponent', {})
  return saveComponent(tx, stamp, project, null, { name: trimmed, description: '' })
}

/** The name of the component of this id; `null` — none. */
export async function componentName(tx: Transaction, id: string | null): Promise<string | null> {
  if (id === null) return null
  const { rows } = await tx.query<{ name: string }>('select name from builtin_components where id = $1', [id])
  return rows[0]?.name ?? null
}

/**
 * Deletes the component; its tasks, closed ones too, go to the component `to` or to none, each recording the move. The
 * component's own history stays, its deletion last. Returns the moved tasks' row ids.
 */
export async function removeComponent(tx: Transaction, stamp: Stamp, project: string, id: string, to: string | null): Promise<string[]> {
  const was = await rowOf(tx, project, id)
  const target = to === null ? null : to === id ? null : await rowOf(tx, project, to).catch(() => null)
  if (to !== null && target === null) throw fail('builtin.noComponent', {})
  const { rows: tasks } = await tx.query<{ id: string }>('select id from builtin_tasks where component_id = $1', [id])
  const moved = tasks.map((each) => each.id)
  await tx.query('update builtin_tasks set component_id = $2, version = version + 1, updated_at = $3 where component_id = $1', [id, to, stamp.at])
  for (const task of moved) await logTask(tx, stamp.at, stamp.writer, { id: task, project_id: project }, [{ field: 'component', before: was.name, after: target?.name ?? null }])
  await tx.query('delete from builtin_components where id = $1', [id])
  await logComponent(tx, stamp.at, stamp.writer, project, id, { field: 'removed', from: was.name, to: null })
  return moved
}

async function rowOf(tx: Transaction, project: string, id: string): Promise<{ name: string; description: string }> {
  const { rows } = await tx.query<{ name: string; description: string }>('select name, description from builtin_components where id = $1 and project_id = $2', [id, project])
  if (rows[0] === undefined) throw fail('builtin.noComponent', {})
  return rows[0]
}

function nameOf(name: string): string {
  const trimmed = name.trim()
  if (trimmed === '') throw fail('builtin.emptyName', {})
  return trimmed
}
