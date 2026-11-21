import { fail } from '../notice/notice.js'
import type { Db } from '../storage/database.js'
import { PRIORITIES, type TaskPriority, type TaskStatus } from '../tracker/model.js'
import { BUILTIN_STATUSES, builtinStatus, type BuiltinMilestone, type CommentAuthor, type RelationKind } from './model.js'

/** A task of the built-in tracker: its project's id and its number there. */
export interface TaskKey {
  project: string
  number: number
}

export interface BuiltinTask extends TaskKey {
  title: string
  /** Markdown. */
  description: string
  /** Grows only when the description changes: a whole replacement names the one it started from. */
  descriptionRev: number
  status: TaskStatus
  priority: TaskPriority
  milestone: BuiltinMilestone | null
  /** The component's name (BTN-1288); `null` — none. */
  component: string | null
  /** The parent's number in the same project. */
  parent: number | null
  subtasks: number
  labels: string[]
  blockedBy: TaskKey[]
  blocks: TaskKey[]
  related: TaskKey[]
  /** Grows on every change of the task: a poll compares it, nothing is refused by it. */
  version: number
  createdAt: string
  updatedAt: string
  /** Minutes of the agent's work (BTN-911); `null` — none. */
  estimate: number | null
}

export interface BuiltinComment {
  id: string
  author: CommentAuthor
  body: string
  at: string
  /** `<Provider> | <model>` of the session an agent's comment came from; `null` — not an agent's, or not known. */
  model: string | null
  /** The name of another person of the tracker an imported comment came from (BTN-1405); absent — the user's own. */
  name?: string
}

/** An attachment of a task (BTN-773): its bytes are `files/<sha256>` of the state database's folder. */
export interface BuiltinFile {
  id: string
  name: string
  /** What the browser declared; shown only, never served as. */
  type: string
  size: number
  sha256: string
  at: string
}

export interface NewBuiltinTask {
  project: string
  title: string
  description?: string
  /** Todo by default, so the chain takes it. */
  status?: string
  priority?: TaskPriority
  /** Created when the project has none of this name. */
  milestone?: string | null
  /** One of the project's components by name; an unknown one is refused, never created. */
  component?: string | null
  parent?: number | null
  labels?: string[]
  /** Minutes of the agent's work; none by default. */
  estimate?: number | null
  /** The row's id, chosen by the caller (a tasks_create marker, BTN-905); a new UUID by default. */
  id?: string
  /** The number the import keeps from the source tracker (BTN-1405); one past the last by default. */
  number?: number
}

/**
 * An edit of a short field: what the editor saw and what it sets. Refused only when the field holds neither by now, so
 * another edit of another field, or of this one to the same value, is no conflict.
 */
export type FieldEdit =
  | { field: 'title'; from: string; to: string }
  | { field: 'status'; from: string; to: string }
  | { field: 'priority'; from: TaskPriority; to: TaskPriority }
  /** By name; a new name creates the milestone. */
  | { field: 'milestone'; from: string | null; to: string | null }
  /** By name; an unknown name is refused, or made a new component with `create` (the card's "Create"). */
  | { field: 'component'; from: string | null; to: string | null; create?: boolean }
  | { field: 'parent'; from: number | null; to: number | null }
  /** The whole text, as typed: the card's editor (BTN-772). An agent's edits go by revision or by patch. */
  | { field: 'description'; from: string; to: string }

export interface TaskRow {
  id: string
  project_id: string
  number: number
  title: string
  description: string
  description_rev: number
  status: string
  priority: string
  milestone_id: string | null
  parent_id: string | null
  version: number
  created_at: string
  updated_at: string
}

export const TASK_COLUMNS = 'id, project_id, number, title, description, description_rev, status, priority, milestone_id, parent_id, version, created_at, updated_at'
export const FILE_COLUMNS = 'id, name, type, size::float8 as size, sha256, at'

export const fileOf = (row: BuiltinFile): BuiltinFile => ({ id: row.id, name: row.name, type: row.type, size: Number(row.size), sha256: row.sha256, at: row.at })

/** The tasks of the projects, or the one of `number`, by project and number. */
export async function readTasks(db: Db, projects: readonly string[], number?: number): Promise<BuiltinTask[]> {
  if (projects.length === 0) return []
  const { rows } = await db.query<
    TaskRow & { estimate: number | null; milestone: string | null; milestone_date: number | null; component: string | null; parent: number | null; subtasks: number }
  >(
    `select t.id, t.project_id, t.number, t.title, t.description, t.description_rev, t.status, t.priority, t.version,
            t.created_at, t.updated_at, t.estimate, m.name as milestone, m.date::float8 as milestone_date, k.name as component,
            p.number as parent, (select count(*)::int from builtin_tasks c where c.parent_id = t.id) as subtasks
       from builtin_tasks t
       left join builtin_milestones m on m.id = t.milestone_id
       left join builtin_components k on k.id = t.component_id
       left join builtin_tasks p on p.id = t.parent_id
      where t.project_id = any($1) and ($2::int is null or t.number = $2)
      order by t.project_id, t.number`,
    [projects, number ?? null],
  )
  if (rows.length === 0) return []
  const ids = rows.map((row) => row.id)
  const labels = await db.query<{ task_id: string; name: string }>(
    `select tl.task_id, l.name from builtin_task_labels tl join builtin_labels l on l.id = tl.label_id
      where tl.task_id = any($1) order by lower(l.name)`,
    [ids],
  )
  const links = await db.query<{ from_id: string; to_id: string; kind: RelationKind; from_project: string; from_number: number; to_project: string; to_number: number }>(
    `select r.from_id, r.to_id, r.kind, a.project_id as from_project, a.number as from_number, b.project_id as to_project, b.number as to_number
       from builtin_relations r join builtin_tasks a on a.id = r.from_id join builtin_tasks b on b.id = r.to_id
      where r.from_id = any($1) or r.to_id = any($1)
      order by b.project_id, b.number, a.project_id, a.number`,
    [ids],
  )
  return rows.map((row) => {
    const mine = links.rows.filter((link) => link.from_id === row.id || link.to_id === row.id)
    const other = (link: (typeof mine)[number]): TaskKey =>
      link.from_id === row.id ? { project: link.to_project, number: link.to_number } : { project: link.from_project, number: link.from_number }
    return {
      project: row.project_id,
      number: row.number,
      title: row.title,
      description: row.description,
      descriptionRev: row.description_rev,
      status: builtinStatus(row.status) ?? { name: row.status, category: 'UnStarted' },
      priority: priorityOf(row.priority),
      milestone: row.milestone === null ? null : { name: row.milestone, date: row.milestone_date },
      component: row.component,
      parent: row.parent,
      subtasks: row.subtasks,
      labels: labels.rows.filter((label) => label.task_id === row.id).map((label) => label.name),
      blockedBy: mine.filter((link) => link.kind === 'blocks' && link.to_id === row.id).map(other),
      blocks: mine.filter((link) => link.kind === 'blocks' && link.from_id === row.id).map(other),
      related: mine.filter((link) => link.kind === 'relates').map(other),
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      estimate: row.estimate,
    }
  })
}

/** Whole minutes; the tasks server already refuses anything below one. */
export function estimateOf(minutes: number | null): number | null {
  return minutes === null ? null : Math.round(minutes)
}

export function titleOf(title: string): string {
  const trimmed = title.trim()
  if (trimmed === '') throw fail('builtin.emptyName', {})
  return trimmed
}

export function statusOf(name: string): TaskStatus {
  const status = builtinStatus(name)
  if (status === undefined) throw fail('builtin.badStatus', { status: name, statuses: BUILTIN_STATUSES.map((each) => each.name) })
  return status
}

export function priorityOf(priority: string): TaskPriority {
  if (!(PRIORITIES as readonly string[]).includes(priority)) throw fail('builtin.badPriority', { priority })
  return priority as TaskPriority
}

/**
 * A field's value as compared: a status, a milestone and a component by name ignoring case, a title as trimmed, a
 * description as is.
 */
export function normal(field: FieldEdit['field'], value: string | number | null): string | number | null {
  if (value === null || typeof value === 'number') return value
  if (field === 'status') return builtinStatus(value)?.name ?? value.trim()
  if (field === 'milestone' || field === 'component') return value.trim().toLocaleLowerCase()
  return field === 'title' ? value.trim() : value
}

export function shown(value: string | number | null): string | null {
  return value === null ? null : String(value)
}
