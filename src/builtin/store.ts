import { randomUUID } from 'node:crypto'
import type { Transaction } from '@electric-sql/pglite'
import { inTransaction, type Db } from '../storage/database.js'
import { fail } from '../notice/notice.js'
import type { LabelChange } from '../tracker/labels.js'
import { compareBuiltinMilestones, labelColor, uniqueNames, TODO, type BuiltinMilestone, type CommentAuthor, type RelationKind } from './model.js'
import { closesLoop, laterBlocker } from './links.js'
import type { TaskRun } from '../sessions/runs.js'
import type { ChangeAuthor, ChangeField, TaskChange } from '../tracker/history.js'
import { lineDiff } from './diff.js'
import {
  componentHistory, logMilestone, logTask, milestoneHistory, SERVICE_AUTHOR, taskHistory, writerOf, type ComponentChange, type HistoryRow,
  type MilestoneChange,
} from './history-log.js'
import {
  componentIdOf, componentName, listComponents, removeComponent, saveComponent, type BuiltinComponent, type ComponentFields, type Stamp,
} from './components.js'
import {
  listMilestones, milestoneIdOf, removeMilestone, saveMilestone as saveMilestoneFields, type BuiltinMilestoneRow, type MilestoneFields, type MilestoneRenamed,
} from './milestones.js'

import {
  estimateOf, FILE_COLUMNS, fileOf, normal, priorityOf, readTasks, shown, statusOf, TASK_COLUMNS, titleOf,
  type BuiltinComment, type BuiltinFile, type BuiltinTask, type FieldEdit, type NewBuiltinTask, type TaskKey, type TaskRow,
} from './task-rows.js'

export type { BuiltinComment, BuiltinFile, BuiltinTask, FieldEdit, NewBuiltinTask, TaskKey } from './task-rows.js'

type FileRow = BuiltinFile

/**
 * The built-in tracker's tasks in the state database (BTN-767, step 30). A task is named by its project's id and number;
 * `nameOf` gives the `<KEY>-<N>` the messages show. Every write runs in one transaction; nothing is deleted but by `remove`.
 * Every change of a field is recorded in the task's history (BTN-1112) in the same transaction, as made by `author`.
 */
export class BuiltinStore {
  constructor(
    private readonly db: Db,
    private readonly nameOf: (key: TaskKey) => string = ({ project, number }) => `${project}-${number}`,
    private readonly now: () => Date = () => new Date(),
    private readonly author: ChangeAuthor = SERVICE_AUTHOR,
  ) {}

  /** The same store, its writes recorded as made by `author`. */
  as(author: ChangeAuthor): BuiltinStore {
    return new BuiltinStore(this.db, this.nameOf, this.now, author)
  }

  /**
   * Creates the task and returns its number: one past the project's last, and past the last of `sharing` — the projects of
   * the same key, so that `<KEY>-<N>` stays one task. A `number` the caller gives (the import's) is kept, and the counter
   * goes on from the greatest.
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
      const number = task.number ?? rows[0]!.last + 1
      await tx.query(
        `insert into builtin_counters (project_id, last) values ($1, $2) on conflict (project_id) do update set last = greatest(builtin_counters.last, excluded.last)`,
        [task.project, number],
      )
      const at = this.stamp()
      const id = task.id ?? randomUUID()
      const milestone = task.milestone == null ? null : await this.milestoneId(tx, task.project, task.milestone)
      const component = task.component == null ? null : await componentIdOf(tx, this.stamped(), task.project, task.component)
      await tx.query(
        `insert into builtin_tasks (${TASK_COLUMNS}, estimate, component_id) values ($1, $2, $3, $4, $5, 0, $6, $7, $8, null, 1, $9, $9, $10, $11)`,
        [id, task.project, number, title, task.description ?? '', status.name, priority, milestone, at, estimateOf(task.estimate ?? null), component],
      )
      const row = { id, project_id: task.project, number }
      await this.log(tx, row, [{ field: 'created', before: null, after: null }])
      if (task.parent != null) await this.setParent(tx, row, task.parent, false)
      for (const name of uniqueNames(task.labels ?? [])) await this.attach(tx, id, task.project, name, false)
      return number
    })
  }

  async get(key: TaskKey): Promise<BuiltinTask | undefined> {
    return (await this.read([key.project], key.number))[0]
  }

  /** The number of the project's task with this row id; `null` — none. */
  async numberOf(project: string, id: string): Promise<number | null> {
    const { rows } = await this.db.query<{ number: number }>('select number from builtin_tasks where project_id = $1 and id = $2', [project, id])
    return rows[0]?.number ?? null
  }

  /** The row id of each task of the project by its number: what outlives a change of the project's key. */
  async rowIds(project: string): Promise<Map<number, string>> {
    const { rows } = await this.db.query<{ id: string; number: number }>('select id, number from builtin_tasks where project_id = $1', [project])
    return new Map(rows.map((row) => [row.number, row.id]))
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
      const changed = (after: string | null) => this.log(tx, row, [{ field: edit.field, before: shown(held), after }])
      switch (edit.field) {
        case 'title':
          await tx.query('update builtin_tasks set title = $2 where id = $1', [row.id, titleOf(edit.to)])
          await changed(titleOf(edit.to))
          break
        case 'status':
          await tx.query('update builtin_tasks set status = $2 where id = $1', [row.id, statusOf(edit.to).name])
          await changed(statusOf(edit.to).name)
          break
        case 'priority':
          await tx.query('update builtin_tasks set priority = $2 where id = $1', [row.id, priorityOf(edit.to)])
          await changed(priorityOf(edit.to))
          break
        case 'milestone': {
          const id = edit.to === null ? null : await this.milestoneId(tx, row.project_id, edit.to)
          await tx.query('update builtin_tasks set milestone_id = $2 where id = $1', [row.id, id])
          const { rows } = await tx.query<{ name: string }>('select name from builtin_milestones where id = $1', [id])
          await changed(rows[0]?.name ?? null)
          break
        }
        case 'component': {
          const id = edit.to === null ? null : await componentIdOf(tx, this.stamped(), row.project_id, edit.to, edit.create === true)
          await tx.query('update builtin_tasks set component_id = $2 where id = $1', [row.id, id])
          await changed(await componentName(tx, id))
          break
        }
        case 'parent':
          await this.setParent(tx, row, edit.to, true)
          break
        case 'description':
          await this.describeAs(tx, row, edit.to)
          break
      }
      return true
    })
  }

  /** Sets the estimate in minutes of the agent's work; `null` removes it. */
  setEstimate(key: TaskKey, minutes: number | null): Promise<BuiltinTask> {
    return this.change(key, async (tx, row) => {
      const minutesNow = estimateOf(minutes)
      const { rows } = await tx.query<{ estimate: number | null }>('select estimate from builtin_tasks where id = $1', [row.id])
      const before = rows[0]?.estimate ?? null
      if (before === minutesNow) return false
      await tx.query('update builtin_tasks set estimate = $2 where id = $1', [row.id, minutesNow])
      await this.log(tx, row, [{ field: 'estimate', before: shown(before), after: shown(minutesNow) }])
      return true
    })
  }

  /** Replaces the description whole; refused when it changed since the revision `from` the editor started from. */
  setDescription(key: TaskKey, text: string, from: number): Promise<BuiltinTask> {
    return this.change(key, async (tx, row) => {
      if (row.description_rev !== from) throw fail('builtin.descriptionConflict', { task: this.nameOf(key), rev: row.description_rev })
      if (row.description === text) return false
      await this.describeAs(tx, row, text)
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
      await this.describeAs(tx, row, text)
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
      await this.describeAs(tx, row, text)
      return true
    })
  }

  /** Removes, then adds labels, ignoring case; a label the project lacks is created. Returns the task's labels. */
  async relabel(key: TaskKey, change: LabelChange): Promise<string[]> {
    const task = await this.change(key, async (tx, row) => {
      let changed = false
      for (const name of uniqueNames(change.remove)) {
        const { rows } = await tx.query<{ name: string }>(
          `delete from builtin_task_labels tl using builtin_labels l
            where tl.task_id = $1 and tl.label_id = l.id and lower(l.name) = lower($2) returning l.name`,
          [row.id, name],
        )
        if (rows[0] !== undefined) await this.log(tx, row, [{ field: 'label', before: rows[0].name, after: null }])
        changed ||= rows.length > 0
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

  /**
   * Posts a comment and returns its id; `model` — of the session an agent's comment came from; `name` — of another person
   * of the tracker an imported comment came from (BTN-1405).
   */
  async comment(key: TaskKey, author: CommentAuthor, body: string, model: string | null = null, name: string | null = null): Promise<string> {
    let id = ''
    await this.change(key, async (tx, row) => {
      const { rows } = await tx.query<{ id: number }>(
        'insert into builtin_comments (task_id, author, body, at, model, author_name) values ($1, $2, $3, $4, $5, $6) returning id',
        [row.id, author, body, this.stamp(), author === 'agent' ? model : null, author === 'person' ? name : null],
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
        "delete from builtin_comments where task_id = $1 and id = $2 and author = 'person' and author_name is null returning id",
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
    const { rows } = await this.db.query<{ id: number; author: CommentAuthor; body: string; at: string; model: string | null; author_name: string | null }>(
      'select id, author, body, at, model, author_name from builtin_comments where task_id = $1 order by id',
      [row.id],
    )
    const list: BuiltinComment[] = rows.map(({ author_name, ...each }) => ({ ...each, id: String(each.id), ...(author_name === null ? {} : { name: author_name }) }))
    if (after === undefined) return list
    const index = list.findIndex((each) => each.id === after)
    return index < 0 ? [] : list.slice(index + 1)
  }

  /**
   * Records an attachment whose bytes are already on disk; the same bytes in the same task give the record it has.
   * Moves the task's version only for a new record.
   */
  async addFile(key: TaskKey, file: Omit<BuiltinFile, 'id' | 'at'>): Promise<BuiltinFile> {
    let made: BuiltinFile | undefined
    await this.change(key, async (tx, row) => {
      const { rows } = await tx.query<FileRow>(
        `insert into builtin_files (id, task_id, name, type, size, sha256, at) values ($1, $2, $3, $4, $5, $6, $7)
          on conflict (task_id, sha256) do nothing returning ${FILE_COLUMNS}`,
        [randomUUID(), row.id, file.name, file.type, file.size, file.sha256, this.stamp()],
      )
      if (rows[0] !== undefined) {
        made = fileOf(rows[0])
        return true
      }
      const { rows: had } = await tx.query<FileRow>(`select ${FILE_COLUMNS} from builtin_files where task_id = $1 and sha256 = $2`, [row.id, file.sha256])
      made = fileOf(had[0]!)
      return false
    })
    return made!
  }

  /** Deletes the task's attachment record; the bytes stay for the sweep. `false` — the task has no such attachment. */
  async removeFile(key: TaskKey, id: string): Promise<boolean> {
    let removed = false
    await this.change(key, async (tx, row) => {
      const { rows } = await tx.query('delete from builtin_files where task_id = $1 and id = $2 returning id', [row.id, id])
      removed = rows.length > 0
      return removed
    })
    return removed
  }

  /** The task's attachments, oldest first. */
  async files(key: TaskKey): Promise<BuiltinFile[]> {
    const row = await this.row(this.db, key)
    if (row === undefined) return []
    const { rows } = await this.db.query<FileRow>(`select ${FILE_COLUMNS} from builtin_files where task_id = $1 order by at, id`, [row.id])
    return rows.map(fileOf)
  }

  /** The name an attachment of these bytes has in the task, if any. */
  async fileName(key: TaskKey, sha256: string): Promise<string | undefined> {
    const row = await this.row(this.db, key)
    if (row === undefined) return undefined
    const { rows } = await this.db.query<{ name: string }>('select name from builtin_files where task_id = $1 and sha256 = $2', [row.id, sha256])
    return rows[0]?.name
  }

  /** The hashes some record still points at: what the sweep keeps. */
  async fileHashes(): Promise<Set<string>> {
    const { rows } = await this.db.query<{ sha256: string }>('select distinct sha256 from builtin_files')
    return new Set(rows.map((each) => each.sha256))
  }

  /**
   * Deletes the task with its labels, links, comments, history and attachment records; its subtasks lose the parent. The
   * tasks it was linked with record the lost link. `false` — no such task.
   */
  remove(key: TaskKey): Promise<boolean> {
    return inTransaction(this.db, async (tx) => {
      const row = await this.row(tx, key)
      if (row === undefined) return false
      const name = this.nameOf(key)
      const { rows: linked } = await tx.query<{ id: string; project_id: string; field: ChangeField }>(
        `select t.id, t.project_id, case when r.kind = 'relates' then 'relates' when r.from_id = $1 then 'blockedBy' else 'blocks' end as field
           from builtin_relations r join builtin_tasks t on t.id = case when r.from_id = $1 then r.to_id else r.from_id end
          where r.from_id = $1 or r.to_id = $1
         union all select id, project_id, 'parent' from builtin_tasks where parent_id = $1
         union all select id, project_id, 'subtask' from builtin_tasks where id = $2`,
        [row.id, row.parent_id],
      )
      for (const other of linked) await this.log(tx, other, [{ field: other.field, before: name, after: null }])
      await tx.query('delete from builtin_history where task_id = $1', [row.id])
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
      await tx.query('delete from builtin_files where task_id = $1', [row.id])
      await tx.query('delete from builtin_tasks where id = $1', [row.id])
      return true
    })
  }

  /** Deletes every task of the project, its counter, labels and milestones: nothing of it is left (the demo's removal, BTN-776). */
  forget(project: string): Promise<void> {
    return inTransaction(this.db, async (tx) => {
      const tasks = 'select id from builtin_tasks where project_id = $1'
      await tx.query(`delete from builtin_history where project_id = $1 or task_id in (${tasks})`, [project])
      await tx.query(`delete from builtin_relations where from_id in (${tasks}) or to_id in (${tasks})`, [project])
      for (const table of ['builtin_task_labels', 'builtin_comments', 'builtin_files']) await tx.query(`delete from ${table} where task_id in (${tasks})`, [project])
      await tx.query('update builtin_tasks set parent_id = null where project_id = $1', [project])
      for (const table of ['builtin_tasks', 'builtin_counters', 'builtin_labels', 'builtin_milestones', 'builtin_components']) {
        await tx.query(`delete from ${table} where project_id = $1`, [project])
      }
    })
  }

  /** The project's components by name, with how many tasks each has (BTN-1288). */
  components(project: string): Promise<BuiltinComponent[]> {
    return listComponents(this.db, project)
  }

  /** Creates the component (`id` `null`) or changes its name and description; returns its id. */
  saveComponent(project: string, id: string | null, fields: ComponentFields): Promise<string> {
    return inTransaction(this.db, (tx) => saveComponent(tx, this.stamped(), project, id, fields))
  }

  /** Deletes the component, its tasks going to the component `to` or to none. */
  async removeComponent(project: string, id: string, to: string | null): Promise<void> {
    await inTransaction(this.db, (tx) => removeComponent(tx, this.stamped(), project, id, to))
  }

  /** The component's changes, oldest first. */
  componentHistory(component: string): Promise<ComponentChange[]> {
    return componentHistory(this.db, component)
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
      const { rows } = await tx.query<{ date: number | null }>('select date::float8 as date from builtin_milestones where id = $1', [id])
      const before = rows[0]?.date ?? null
      if (before === date) return id
      await tx.query('update builtin_milestones set date = $2 where id = $1', [id, date])
      await this.logMilestone(tx, project, id, 'date', shown(before), shown(date))
      return id
    })
  }

  /** The project's milestones with every field and their task counts, as the tracker window lists them (BTN-1287). */
  milestoneList(project: string): Promise<BuiltinMilestoneRow[]> {
    return listMilestones(this.db, project)
  }

  /** Creates the milestone (`id` `null`) or changes it; a rename goes to `renamed` inside the write. Returns its id. */
  editMilestone(project: string, id: string | null, fields: MilestoneFields, renamed?: MilestoneRenamed): Promise<string> {
    return inTransaction(this.db, (tx) => saveMilestoneFields(tx, this.stamped(), project, id, fields, renamed))
  }

  /** Deletes the milestone, its tasks going to the milestone `to` or to none; refused while it has a closed task. */
  async removeMilestone(project: string, id: string, to: string | null, renamed?: MilestoneRenamed): Promise<void> {
    await inTransaction(this.db, (tx) => removeMilestone(tx, this.stamped(), project, id, to, renamed))
  }

  /** The milestone's changes, oldest first. */
  milestoneHistory(milestone: string): Promise<MilestoneChange[]> {
    return milestoneHistory(this.db, milestone)
  }

  /** The task's changes, oldest first (BTN-1112); `[]` — no such task. */
  async history(key: TaskKey): Promise<TaskChange[]> {
    const row = await this.row(this.db, key)
    return row === undefined ? [] : taskHistory(this.db, row.id)
  }

  /**
   * Records a change of the task's run (BTN-983): Even Keel keeps the run, not the tracker, so the store only writes the
   * history. Neither the task's version nor its time move.
   */
  async noteRun(key: TaskKey, from: TaskRun | null, to: TaskRun | null): Promise<void> {
    await inTransaction(this.db, async (tx) => {
      const row = await this.row(tx, key)
      if (row === undefined) return
      const text = (run: TaskRun | null) => (run === null ? null : JSON.stringify({ provider: run.provider, model: run.model, effort: run.effort }))
      await this.log(tx, row, [{ field: 'run', before: text(from), after: text(to) }])
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

  private stamped(): Stamp {
    return { at: this.stamp(), writer: writerOf(this.author) }
  }

  private log(tx: Transaction, row: Pick<TaskRow, 'id' | 'project_id'>, changes: HistoryRow[]): Promise<void> {
    return logTask(tx, this.stamp(), writerOf(this.author), row, changes)
  }

  private logMilestone(tx: Transaction, project: string, milestone: string, field: MilestoneChange['field'], before: string | null, after: string | null): Promise<void> {
    return logMilestone(tx, this.stamp(), writerOf(this.author), project, milestone, field, before, after)
  }

  /** Sets the description and records its difference, never the two texts. */
  private async describeAs(tx: Transaction, row: TaskRow, text: string): Promise<void> {
    await tx.query('update builtin_tasks set description = $2, description_rev = description_rev + 1 where id = $1', [row.id, text])
    await this.log(tx, row, [{ field: 'description', before: null, after: JSON.stringify(lineDiff(row.description, text)) }])
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
      case 'component': {
        const { rows } = await tx.query<{ component_id: string | null }>('select component_id from builtin_tasks where id = $1', [row.id])
        return componentName(tx, rows[0]?.component_id ?? null)
      }
      case 'parent': {
        if (row.parent_id === null) return null
        const { rows } = await tx.query<{ number: number }>('select number from builtin_tasks where id = $1', [row.parent_id])
        return rows[0]?.number ?? null
      }
    }
  }

  private milestoneId(tx: Transaction, project: string, name: string): Promise<string> {
    return milestoneIdOf(tx, this.stamped(), project, name)
  }

  /** `true` — the task had no such label; `logged` — the history records it. */
  private async attach(tx: Transaction, task: string, project: string, name: string, logged = true): Promise<boolean> {
    const trimmed = name.trim()
    const found = await tx.query<{ id: string }>('select id from builtin_labels where project_id = $1 and lower(name) = lower($2)', [project, trimmed])
    let label = found.rows[0]?.id
    if (label === undefined) {
      label = randomUUID()
      await tx.query('insert into builtin_labels (id, project_id, name, color) values ($1, $2, $3, $4)', [label, project, trimmed, labelColor(trimmed)])
    }
    const { affectedRows } = await tx.query('insert into builtin_task_labels (task_id, label_id) values ($1, $2) on conflict do nothing', [task, label])
    const added = (affectedRows ?? 0) > 0
    if (added && logged) {
      const { rows } = await tx.query<{ name: string }>('select name from builtin_labels where id = $1', [label])
      await this.log(tx, { id: task, project_id: project }, [{ field: 'label', before: null, after: rows[0]!.name }])
    }
    return added
  }

  /**
   * Sets the parent; the old and the new parent record the subtask they lost or got, and the task records its new parent
   * when `logged` (a new task records only its creation).
   */
  private async setParent(tx: Transaction, row: Pick<TaskRow, 'id' | 'project_id' | 'number'>, parent: number | null, logged: boolean): Promise<void> {
    const task = this.nameOf({ project: row.project_id, number: row.number })
    const { rows: was } = await tx.query<{ id: string; number: number }>(
      'select p.id, p.number from builtin_tasks t join builtin_tasks p on p.id = t.parent_id where t.id = $1',
      [row.id],
    )
    const old = was[0]
    const history = async (target: { id: string; number: number } | undefined) => {
      if (old?.id === target?.id) return
      const name = (each: { number: number } | undefined) => (each === undefined ? null : this.nameOf({ project: row.project_id, number: each.number }))
      if (logged) await this.log(tx, row, [{ field: 'parent', before: name(old), after: name(target) }])
      if (old !== undefined) await this.log(tx, { id: old.id, project_id: row.project_id }, [{ field: 'subtask', before: task, after: null }])
      if (target !== undefined) await this.log(tx, { id: target.id, project_id: row.project_id }, [{ field: 'subtask', before: null, after: task }])
    }
    if (parent === null) {
      await tx.query('update builtin_tasks set parent_id = null where id = $1', [row.id])
      await history(undefined)
      return
    }
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
    await history(target)
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
      if ((affectedRows ?? 0) === 0) return
      await this.touch(tx, [left.id, right.id])
      // Each side records the link under its own name for it: `from` blocks, `to` is blocked by.
      const [leftName, rightName] = [this.nameOf(from), this.nameOf(to)]
      const side = (field: ChangeField, other: string): HistoryRow[] => [{ field, before: on ? null : other, after: on ? other : null }]
      await this.log(tx, left, side(kind === 'blocks' ? 'blocks' : 'relates', rightName))
      await this.log(tx, right, side(kind === 'blocks' ? 'blockedBy' : 'relates', leftName))
    })
  }

  private read(projects: readonly string[], number?: number): Promise<BuiltinTask[]> {
    return readTasks(this.db, projects, number)
  }
}
