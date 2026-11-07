import { randomUUID } from 'node:crypto'
import type { Transaction } from '@electric-sql/pglite'
import { inTransaction, type Db } from '../storage/database.js'
import { fail } from '../notice/notice.js'
import { PRIORITIES, type TaskPriority, type TaskStatus } from '../tracker/model.js'
import type { LabelChange } from '../tracker/labels.js'
import {
  BUILTIN_STATUSES, builtinStatus, compareBuiltinMilestones, labelColor, uniqueNames, TODO,
  type BuiltinMilestone, type CommentAuthor, type RelationKind,
} from './model.js'
import { closesLoop, laterBlocker } from './links.js'

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
}

export interface BuiltinComment {
  id: string
  author: CommentAuthor
  body: string
  at: string
  /** `<Provider> | <model>` of the session an agent's comment came from; `null` — not an agent's, or not known. */
  model: string | null
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
  parent?: number | null
  labels?: string[]
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
  | { field: 'parent'; from: number | null; to: number | null }
  /** The whole text, as typed: the card's editor (BTN-772). An agent's edits go by revision or by patch. */
  | { field: 'description'; from: string; to: string }

interface TaskRow {
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

const TASK_COLUMNS = 'id, project_id, number, title, description, description_rev, status, priority, milestone_id, parent_id, version, created_at, updated_at'

/**
 * The built-in tracker's tasks in the state database (BTN-767, step 30). A task is named by its project's id and number;
 * `nameOf` gives the `<KEY>-<N>` the messages show. Every write runs in one transaction; nothing is deleted but by `remove`.
 */
export class BuiltinStore {
  constructor(
    private readonly db: Db,
    private readonly nameOf: (key: TaskKey) => string = ({ project, number }) => `${project}-${number}`,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Creates the task and returns its number: one past the project's last, and past the last of `sharing` — the projects of
   * the same key, so that `<KEY>-<N>` stays one task.
   */
  create(task: NewBuiltinTask, sharing: readonly string[] = []): Promise<number> {
    return inTransaction(this.db, async (tx) => {
      const title = titleOf(task.title)
      const status = statusOf(task.status ?? TODO.name)
      const priority = priorityOf(task.priority ?? 'none')
      const { rows } = await tx.query<{ last: number }>(
        'select coalesce(max(last), 0)::int as last from builtin_counters where project_id = any($1)',
        [[task.project, ...sharing]],
      )
      const number = rows[0]!.last + 1
      await tx.query(
        `insert into builtin_counters (project_id, last) values ($1, $2) on conflict (project_id) do update set last = excluded.last`,
        [task.project, number],
      )
      const at = this.stamp()
      const id = randomUUID()
      const milestone = task.milestone == null ? null : await this.milestoneId(tx, task.project, task.milestone)
      await tx.query(
        `insert into builtin_tasks (${TASK_COLUMNS}) values ($1, $2, $3, $4, $5, 0, $6, $7, $8, null, 1, $9, $9)`,
        [id, task.project, number, title, task.description ?? '', status.name, priority, milestone, at],
      )
      if (task.parent != null) await this.setParent(tx, { id, project_id: task.project, number }, task.parent)
      for (const name of uniqueNames(task.labels ?? [])) await this.attach(tx, id, task.project, name)
      return number
    })
  }

  async get(key: TaskKey): Promise<BuiltinTask | undefined> {
    return (await this.read([key.project], key.number))[0]
  }

  /** Every task of the projects, by project and number. */
  list(projects: readonly string[]): Promise<BuiltinTask[]> {
    return this.read(projects)
  }

  /** The direct subtasks of the task. */
  async children(key: TaskKey): Promise<BuiltinTask[]> {
    const parent = await this.row(this.db, key)
    return parent === undefined ? [] : (await this.read([key.project])).filter((task) => task.parent === key.number)
  }

  /** The numbers of the task's ancestors, the root first and the direct parent last. */
  async ancestors(key: TaskKey): Promise<number[]> {
    const { rows } = await this.db.query<{ number: number; depth: number }>(
      `with recursive up(id, parent_id, number, depth) as (
         select id, parent_id, number, 0 from builtin_tasks where project_id = $1 and number = $2
         union all select t.id, t.parent_id, t.number, up.depth + 1 from builtin_tasks t join up on t.id = up.parent_id
       ) select number, depth from up where depth > 0 order by depth desc`,
      [key.project, key.number],
    )
    return rows.map((row) => row.number)
  }

  /**
   * Tasks of the projects whose title holds `text`, ignoring case, or whose number it is, by project and number; with no
   * text, the newest first. At most `limit`.
   */
  async search(projects: readonly string[], text: string, limit = 20): Promise<BuiltinTask[]> {
    const needle = text.trim().toLocaleLowerCase()
    const number = /^\d+$/.test(needle) ? Number(needle) : null
    const found = (await this.read(projects)).filter((task) => needle === '' || task.number === number || task.title.toLocaleLowerCase().includes(needle))
    return (needle === '' ? found.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.number - a.number) : found).slice(0, limit)
  }

  /** The edited task. */
  edit(key: TaskKey, edit: FieldEdit): Promise<BuiltinTask> {
    return this.change(key, async (tx, row) => {
      const held = await this.fieldOf(tx, row, edit.field)
      const current = normal(edit.field, held)
      if (current === normal(edit.field, edit.to)) return false
      if (current !== normal(edit.field, edit.from)) throw fail('builtin.conflict', { task: this.nameOf(key), field: edit.field, current: shown(held) })
      switch (edit.field) {
        case 'title':
          await tx.query('update builtin_tasks set title = $2 where id = $1', [row.id, titleOf(edit.to)])
          break
        case 'status':
          await tx.query('update builtin_tasks set status = $2 where id = $1', [row.id, statusOf(edit.to).name])
          break
        case 'priority':
          await tx.query('update builtin_tasks set priority = $2 where id = $1', [row.id, priorityOf(edit.to)])
          break
        case 'milestone': {
          const id = edit.to === null ? null : await this.milestoneId(tx, row.project_id, edit.to)
          await tx.query('update builtin_tasks set milestone_id = $2 where id = $1', [row.id, id])
          break
        }
        case 'parent':
          await this.setParent(tx, row, edit.to)
          break
        case 'description':
          await tx.query('update builtin_tasks set description = $2, description_rev = description_rev + 1 where id = $1', [row.id, edit.to])
          break
      }
      return true
    })
  }

  /** Replaces the description whole; refused when it changed since the revision `from` the editor started from. */
  setDescription(key: TaskKey, text: string, from: number): Promise<BuiltinTask> {
    return this.change(key, async (tx, row) => {
      if (row.description_rev !== from) throw fail('builtin.descriptionConflict', { task: this.nameOf(key), rev: row.description_rev })
      if (row.description === text) return false
      await tx.query('update builtin_tasks set description = $2, description_rev = description_rev + 1 where id = $1', [row.id, text])
      return true
    })
  }

  /** Replaces `old` with `next` in the description; `old` must be there exactly once. Needs no revision. */
  patchDescription(key: TaskKey, old: string, next: string): Promise<BuiltinTask> {
    return this.change(key, async (tx, row) => {
      const count = old === '' ? 0 : row.description.split(old).length - 1
      if (count !== 1) throw fail('builtin.patchMissing', { task: this.nameOf(key), count })
      if (old === next) return false
      const at = row.description.indexOf(old)
      const text = row.description.slice(0, at) + next + row.description.slice(at + old.length)
      await tx.query('update builtin_tasks set description = $2, description_rev = description_rev + 1 where id = $1', [row.id, text])
      return true
    })
  }

  /**
   * Rewrites the description by `change` of the text as it is inside the transaction; `null` — nothing changes. A throw
   * of `change` leaves it as it was. Needs no revision.
   */
  rewriteDescription(key: TaskKey, change: (text: string) => string | null): Promise<BuiltinTask> {
    return this.change(key, async (tx, row) => {
      const text = change(row.description)
      if (text === null || text === row.description) return false
      await tx.query('update builtin_tasks set description = $2, description_rev = description_rev + 1 where id = $1', [row.id, text])
      return true
    })
  }

  /** Removes, then adds labels, ignoring case; a label the project lacks is created. Returns the task's labels. */
  async relabel(key: TaskKey, change: LabelChange): Promise<string[]> {
    const task = await this.change(key, async (tx, row) => {
      let changed = false
      for (const name of uniqueNames(change.remove)) {
        const { affectedRows } = await tx.query(
          `delete from builtin_task_labels tl using builtin_labels l
            where tl.task_id = $1 and tl.label_id = l.id and lower(l.name) = lower($2)`,
          [row.id, name],
        )
        changed ||= (affectedRows ?? 0) > 0
      }
      for (const name of uniqueNames(change.add)) changed = (await this.attach(tx, row.id, row.project_id, name)) || changed
      return changed
    })
    return task.labels
  }

  /** Links two tasks of any projects of the built-in tracker; `blocks` — `from` blocks `to`. Linking twice is nothing. */
  relate(from: TaskKey, to: TaskKey, kind: RelationKind): Promise<void> {
    return this.link(from, to, kind, true)
  }

  unrelate(from: TaskKey, to: TaskKey, kind: RelationKind): Promise<void> {
    return this.link(from, to, kind, false)
  }

  /** Posts a comment and returns its id; `model` — of the session an agent's comment came from. */
  async comment(key: TaskKey, author: CommentAuthor, body: string, model: string | null = null): Promise<string> {
    let id = ''
    await this.change(key, async (tx, row) => {
      const { rows } = await tx.query<{ id: number }>(
        'insert into builtin_comments (task_id, author, body, at, model) values ($1, $2, $3, $4, $5) returning id',
        [row.id, author, body, this.stamp(), author === 'agent' ? model : null],
      )
      id = String(rows[0]!.id)
      return true
    })
    return id
  }

  /** Deletes a person's own comment; anyone else's stays. `false` — the task has no such comment of a person. */
  async uncomment(key: TaskKey, id: string): Promise<boolean> {
    let removed = false
    await this.change(key, async (tx, row) => {
      const { rows } = await tx.query<{ id: number }>(
        "delete from builtin_comments where task_id = $1 and id = $2 and author = 'person' returning id",
        [row.id, Number.isSafeInteger(Number(id)) ? Number(id) : -1],
      )
      removed = rows.length > 0
      return removed
    })
    return removed
  }

  /** The task's comments, oldest first; with `after`, those posted after it — `[]` when it is not the task's. */
  async comments(key: TaskKey, after?: string): Promise<BuiltinComment[]> {
    const row = await this.row(this.db, key)
    if (row === undefined) return []
    const { rows } = await this.db.query<{ id: number; author: CommentAuthor; body: string; at: string; model: string | null }>(
      'select id, author, body, at, model from builtin_comments where task_id = $1 order by id',
      [row.id],
    )
    const list = rows.map((each) => ({ ...each, id: String(each.id) }))
    if (after === undefined) return list
    const index = list.findIndex((each) => each.id === after)
    return index < 0 ? [] : list.slice(index + 1)
  }

  /** Deletes the task with its labels, links and comments; its subtasks lose the parent. `false` — no such task. */
  remove(key: TaskKey): Promise<boolean> {
    return inTransaction(this.db, async (tx) => {
      const row = await this.row(tx, key)
      if (row === undefined) return false
      const at = this.stamp()
      await tx.query(
        `update builtin_tasks set version = version + 1, updated_at = $2
          where id in (select to_id from builtin_relations where from_id = $1 union select from_id from builtin_relations where to_id = $1)
             or parent_id = $1`,
        [row.id, at],
      )
      await tx.query('update builtin_tasks set parent_id = null where parent_id = $1', [row.id])
      await tx.query('delete from builtin_relations where from_id = $1 or to_id = $1', [row.id])
      await tx.query('delete from builtin_task_labels where task_id = $1', [row.id])
      await tx.query('delete from builtin_comments where task_id = $1', [row.id])
      await tx.query('delete from builtin_tasks where id = $1', [row.id])
      return true
    })
  }

  /** The project's milestones in their order. */
  async milestones(project: string): Promise<(BuiltinMilestone & { id: string })[]> {
    const { rows } = await this.db.query<{ id: string; name: string; date: number | null }>(
      'select id, name, date::float8 as date from builtin_milestones where project_id = $1',
      [project],
    )
    return rows.sort(compareBuiltinMilestones)
  }

  /** Creates the milestone, or sets the date of the one of this name; returns its id. */
  saveMilestone(project: string, name: string, date: number | null): Promise<string> {
    return inTransaction(this.db, async (tx) => {
      const id = await this.milestoneId(tx, project, name)
      await tx.query('update builtin_milestones set date = $2 where id = $1', [id, date])
      return id
    })
  }

  /** The project's labels, by name. */
  async labels(project: string): Promise<{ name: string; color: number }[]> {
    const { rows } = await this.db.query<{ name: string; color: number }>(
      'select name, color from builtin_labels where project_id = $1 order by lower(name)',
      [project],
    )
    return rows
  }

  private stamp(): string {
    return this.now().toISOString()
  }

  /** Runs `body` on the task's row; when it says it changed something, the task's version and time move. */
  private async change(key: TaskKey, body: (tx: Transaction, row: TaskRow) => Promise<boolean>): Promise<BuiltinTask> {
    await inTransaction(this.db, async (tx) => {
      const row = await this.row(tx, key)
      if (row === undefined) throw fail('builtin.noTask', { task: this.nameOf(key) })
      if (await body(tx, row)) await this.touch(tx, [row.id])
    })
    return (await this.get(key))!
  }

  private async touch(tx: Transaction, ids: string[]): Promise<void> {
    await tx.query('update builtin_tasks set version = version + 1, updated_at = $2 where id = any($1)', [ids, this.stamp()])
  }

  private async row(db: Db, key: TaskKey): Promise<TaskRow | undefined> {
    const { rows } = await db.query<TaskRow>(`select ${TASK_COLUMNS} from builtin_tasks where project_id = $1 and number = $2`, [key.project, key.number])
    return rows[0]
  }

  private async fieldOf(tx: Transaction, row: TaskRow, field: FieldEdit['field']): Promise<string | number | null> {
    switch (field) {
      case 'title':
        return row.title
      case 'description':
        return row.description
      case 'status':
        return row.status
      case 'priority':
        return row.priority
      case 'milestone': {
        if (row.milestone_id === null) return null
        const { rows } = await tx.query<{ name: string }>('select name from builtin_milestones where id = $1', [row.milestone_id])
        return rows[0]?.name ?? null
      }
      case 'parent': {
        if (row.parent_id === null) return null
        const { rows } = await tx.query<{ number: number }>('select number from builtin_tasks where id = $1', [row.parent_id])
        return rows[0]?.number ?? null
      }
    }
  }

  private async milestoneId(tx: Transaction, project: string, name: string): Promise<string> {
    const trimmed = name.trim()
    if (trimmed === '') throw fail('builtin.emptyName', {})
    const { rows } = await tx.query<{ id: string }>('select id from builtin_milestones where project_id = $1 and lower(name) = lower($2)', [project, trimmed])
    if (rows[0] !== undefined) return rows[0].id
    const id = randomUUID()
    await tx.query('insert into builtin_milestones (id, project_id, name, date) values ($1, $2, $3, null)', [id, project, trimmed])
    return id
  }

  /** `true` — the task had no such label. */
  private async attach(tx: Transaction, task: string, project: string, name: string): Promise<boolean> {
    const trimmed = name.trim()
    const found = await tx.query<{ id: string }>('select id from builtin_labels where project_id = $1 and lower(name) = lower($2)', [project, trimmed])
    let label = found.rows[0]?.id
    if (label === undefined) {
      label = randomUUID()
      await tx.query('insert into builtin_labels (id, project_id, name, color) values ($1, $2, $3, $4)', [label, project, trimmed, labelColor(trimmed)])
    }
    const { affectedRows } = await tx.query('insert into builtin_task_labels (task_id, label_id) values ($1, $2) on conflict do nothing', [task, label])
    return (affectedRows ?? 0) > 0
  }

  private async setParent(tx: Transaction, row: Pick<TaskRow, 'id' | 'project_id' | 'number'>, parent: number | null): Promise<void> {
    if (parent === null) {
      await tx.query('update builtin_tasks set parent_id = null where id = $1', [row.id])
      return
    }
    const task = this.nameOf({ project: row.project_id, number: row.number })
    if (parent === row.number) throw fail('builtin.selfParent', { task })
    const target = await this.row(tx, { project: row.project_id, number: parent })
    if (target === undefined) throw fail('builtin.noTask', { task: this.nameOf({ project: row.project_id, number: parent }) })
    const { rows } = await tx.query<{ id: string }>(
      `with recursive up(id, parent_id) as (
         select id, parent_id from builtin_tasks where id = $1
         union select t.id, t.parent_id from builtin_tasks t join up on t.id = up.parent_id
       ) select id from up where id = $2`,
      [target.id, row.id],
    )
    if (rows.length > 0) throw fail('builtin.parentCycle', { task, parent: this.nameOf({ project: row.project_id, number: parent }) })
    await tx.query('update builtin_tasks set parent_id = $2 where id = $1', [row.id, target.id])
  }

  /** Refuses `left` blocking `right` when the chain could not order it: a loop, or a blocker of a later milestone. */
  private async checkBlock(tx: Transaction, left: TaskRow, right: TaskRow): Promise<void> {
    const names = { task: this.nameOf({ project: left.project_id, number: left.number }), other: this.nameOf({ project: right.project_id, number: right.number }) }
    const { rows } = await tx.query<{ from_id: string; to_id: string }>(`select from_id, to_id from builtin_relations where kind = 'blocks'`)
    if (closesLoop(rows.map((row) => ({ from: row.from_id, to: row.to_id })), left.id, right.id)) throw fail('builtin.blockLoop', names)
    if (left.project_id !== right.project_id || left.milestone_id === null || right.milestone_id === null) return
    const milestones = await tx.query<{ id: string; name: string; date: number | null }>(
      'select id, name, date::float8 as date from builtin_milestones where id = any($1)',
      [[left.milestone_id, right.milestone_id]],
    )
    const of = (id: string) => milestones.rows.find((each) => each.id === id)!
    const [blocker, held] = [of(left.milestone_id), of(right.milestone_id)]
    if (laterBlocker({ label: blocker.name, targetDate: blocker.date }, { label: held.name, targetDate: held.date })) {
      throw fail('builtin.blockerLater', { ...names, milestone: blocker.name })
    }
  }

  private async link(from: TaskKey, to: TaskKey, kind: RelationKind, on: boolean): Promise<void> {
    await inTransaction(this.db, async (tx) => {
      const left = await this.row(tx, from)
      const right = await this.row(tx, to)
      if (left === undefined) throw fail('builtin.noTask', { task: this.nameOf(from) })
      if (right === undefined) throw fail('builtin.noTask', { task: this.nameOf(to) })
      if (left.id === right.id) throw fail('builtin.selfLink', { task: this.nameOf(from) })
      if (on && kind === 'blocks') await this.checkBlock(tx, left, right)
      // `relates` has no direction: one row, whichever way it was made.
      const [a, b] = kind === 'relates' && right.id < left.id ? [right.id, left.id] : [left.id, right.id]
      const { affectedRows } = on
        ? await tx.query('insert into builtin_relations (from_id, to_id, kind) values ($1, $2, $3) on conflict do nothing', [a, b, kind])
        : await tx.query('delete from builtin_relations where from_id = $1 and to_id = $2 and kind = $3', [a, b, kind])
      if ((affectedRows ?? 0) > 0) await this.touch(tx, [left.id, right.id])
    })
  }

  private async read(projects: readonly string[], number?: number): Promise<BuiltinTask[]> {
    if (projects.length === 0) return []
    const { rows } = await this.db.query<TaskRow & { milestone: string | null; milestone_date: number | null; parent: number | null; subtasks: number }>(
      `select t.id, t.project_id, t.number, t.title, t.description, t.description_rev, t.status, t.priority, t.version,
              t.created_at, t.updated_at, m.name as milestone, m.date::float8 as milestone_date, p.number as parent,
              (select count(*)::int from builtin_tasks c where c.parent_id = t.id) as subtasks
         from builtin_tasks t
         left join builtin_milestones m on m.id = t.milestone_id
         left join builtin_tasks p on p.id = t.parent_id
        where t.project_id = any($1) and ($2::int is null or t.number = $2)
        order by t.project_id, t.number`,
      [projects, number ?? null],
    )
    if (rows.length === 0) return []
    const ids = rows.map((row) => row.id)
    const labels = await this.db.query<{ task_id: string; name: string }>(
      `select tl.task_id, l.name from builtin_task_labels tl join builtin_labels l on l.id = tl.label_id
        where tl.task_id = any($1) order by lower(l.name)`,
      [ids],
    )
    const links = await this.db.query<{ from_id: string; to_id: string; kind: RelationKind; from_project: string; from_number: number; to_project: string; to_number: number }>(
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
        parent: row.parent,
        subtasks: row.subtasks,
        labels: labels.rows.filter((label) => label.task_id === row.id).map((label) => label.name),
        blockedBy: mine.filter((link) => link.kind === 'blocks' && link.to_id === row.id).map(other),
        blocks: mine.filter((link) => link.kind === 'blocks' && link.from_id === row.id).map(other),
        related: mine.filter((link) => link.kind === 'relates').map(other),
        version: row.version,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    })
  }
}

function titleOf(title: string): string {
  const trimmed = title.trim()
  if (trimmed === '') throw fail('builtin.emptyName', {})
  return trimmed
}

function statusOf(name: string): TaskStatus {
  const status = builtinStatus(name)
  if (status === undefined) throw fail('builtin.badStatus', { status: name, statuses: BUILTIN_STATUSES.map((each) => each.name) })
  return status
}

function priorityOf(priority: string): TaskPriority {
  if (!(PRIORITIES as readonly string[]).includes(priority)) throw fail('builtin.badPriority', { priority })
  return priority as TaskPriority
}

/** A field's value as compared: a status and a milestone by name ignoring case, a title as trimmed, a description as is. */
function normal(field: FieldEdit['field'], value: string | number | null): string | number | null {
  if (value === null || typeof value === 'number') return value
  if (field === 'status') return builtinStatus(value)?.name ?? value.trim()
  if (field === 'milestone') return value.trim().toLocaleLowerCase()
  return field === 'title' ? value.trim() : value
}

function shown(value: string | number | null): string | null {
  return value === null ? null : String(value)
}
