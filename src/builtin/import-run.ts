import type { Transaction } from '@electric-sql/pglite'
import { inTransaction, type Db } from '../storage/database.js'
import type { ChangeAuthor } from '../tracker/history.js'
import { sameName } from '../chain/rules.js'
import { withBefore, type ImportComment, type ImportGone, type ImportImage, type ImportLink, type ImportMilestone, type ImportSource, type ImportTask } from '../tracker/import.js'
import { importedAuthor, importedStatus, importOrder, type ImportAuthorChoice } from '../tracker/import-plan.js'
import { isOpen } from '../tracker/model.js'
import { componentIdOf } from './components.js'
import { BuiltinFiles, fileUrl } from './files.js'
import { logTask, SERVICE_AUTHOR, writerOf } from './history-log.js'
import { importMilestone, milestoneIdOf } from './milestones.js'
import { BuiltinStore, type TaskKey } from './store.js'
import { estimateOf } from './task-rows.js'

/**
 * The import of a project's whole history into the built-in tracker (BTN-1405), by stages as the copy out goes
 * (`runExport`): the tasks under their own numbers, parents first, with their creation time and author; the links
 * between them; the attachments, with the pictures of the description pointing at them; the journal; the change log.
 * The progress is kept by `ImportLog`, so a repeat goes on from where a failure stopped it.
 */

/** Each task's last finished stage. */
export const IMPORT_STAGES = ['created', 'linked', 'attached', 'journaled', 'done'] as const
export type ImportStage = (typeof IMPORT_STAGES)[number]

/**
 * The value of `ImportRow.files` for an attachment the source has no bytes of (BTN-1454): passed over and not read again,
 * and the check names it apart from the files short.
 */
export const GONE = ''

/** The keys of the task's attachments passed over with no bytes. */
export const goneKeys = (row: ImportRow): string[] => Object.keys(row.files).filter((key) => row.files[key] === GONE)

export interface ImportRow {
  /** The source's own id of the task. */
  ref: string
  number: number
  stage: ImportStage
  /** Files attached or comments posted of the stage after `stage`. */
  done: number
  /** The sha256 of each attached file by its source `key`: a text's pictures point at them; `GONE` — passed over. */
  files: Record<string, string>
  /** How many entries of the change log are written. */
  changes: number
  /** The source as the last check saw the task; `null` — not checked yet. */
  seen: ImportSeen | null
}

/** A task of the source at a check: its time of change and its counts, for a last pass that passes over it (BTN-1432). */
export interface ImportSeen {
  /** `ImportTask.modifiedAt`. */
  at: number
  comments: number
  changes: number
  files: number
}

export interface ImportLog {
  rows(): Promise<ImportRow[]>
  save(row: ImportRow): Promise<void>
}

export interface ImportRun {
  source: ImportSource
  db: Db
  /** The project's id: its built-in tasks are written under it. */
  project: string
  /** The prefix of the tasks' ids, `<key>-<number>`: the history's names and the pictures' addresses. */
  key: string
  /** The folder of the attachments' bytes; without it no attachment moves. */
  filesDir?: string
  authors: readonly ImportAuthorChoice[]
  log: ImportLog
  /** A line of the service log, in English. */
  say?: (line: string) => void
  /** Called as each task the call takes is through: how many of how many. */
  progress?: (done: number, total: number) => void
}

/** The task as the last check saw it: the last pass passes over it. */
export const unchanged = (task: ImportTask, row: ImportRow | undefined): boolean => task.modifiedAt !== null && row?.seen != null && row.seen.at === task.modifiedAt

/**
 * Imports every task of the source by stages; a failed write throws and stops it, and the repeat takes each task from
 * the stage it reached. With `sync` — the last pass before the switch — a task through already gets what changed in the
 * source since: its fields, new links, attachments, comments and changes; one whose time of change stayed as the last
 * check saw it is passed over (BTN-1432). Answers how many tasks the call took.
 */
export async function runImport(run: ImportRun, sync = false): Promise<number> {
  const { source, db, project, log, say = () => {} } = run
  const rows = new Map((await log.rows()).map((row) => [row.ref, row]))
  const tasks = importOrder((await source.tasks()).map((task) => ({ task }))).map((each) => each.task)
  const refs = new Map(tasks.map((task) => [task.ref, task]))
  const throughBefore = new Set([...rows.values()].flatMap((row) => (row.stage === 'done' ? [row.ref] : [])))
  const taken = tasks.filter((task) => !throughBefore.has(task.ref) || (sync && !unchanged(task, rows.get(task.ref)))).length
  let through = 0
  run.progress?.(0, taken)
  const save = async (row: ImportRow) => {
    if (row.stage === 'done' && rows.get(row.ref)?.stage !== 'done') run.progress?.(++through, taken)
    rows.set(row.ref, row)
    await log.save(row)
  }
  const nameOf = (key: TaskKey) => `${run.key}-${key.number}`
  const storeAt = (at: number, author: ChangeAuthor = SERVICE_AUTHOR) => new BuiltinStore(db, nameOf, () => new Date(at), author)
  const writer = (author: ImportTask['createdBy']): ChangeAuthor => {
    const { by, name } = importedAuthor(author, run.authors)
    return { by, model: null, ...(name === null ? {} : { name }) }
  }
  const own = (link: ImportLink | null): ImportTask | null => (link === null || link.foreign ? null : (refs.get(link.ref) ?? null))
  const keyOf = (task: ImportTask): TaskKey => ({ project, number: task.number })
  const at = (stage: ImportStage) => tasks.flatMap((task) => (rows.get(task.ref)?.stage === stage ? [{ task, row: rows.get(task.ref)! }] : []))

  for (const component of new Set(tasks.flatMap((task) => (task.component === null ? [] : [task.component.trim()])))) {
    const known = (await storeAt(Date.now()).components(project)).some((each) => each.name.toLocaleLowerCase() === component.toLocaleLowerCase())
    if (!known && component !== '') await storeAt(Date.now()).saveComponent(project, null, { name: component, description: '' })
  }
  await importMilestones(db, project, await source.milestones(), tasks, sync)

  for (const task of tasks) {
    if (rows.has(task.ref)) continue
    // A create that stopped before its row was saved left the task: it is not made twice.
    if ((await storeAt(task.createdAt).get(keyOf(task))) === undefined) {
      await storeAt(task.createdAt, writer(task.createdBy)).create({
        project,
        number: task.number,
        title: task.title.trim() === '' ? task.id : task.title,
        description: task.description,
        status: importedStatus(task.status).name,
        priority: task.priority,
        milestone: task.milestone,
        component: task.component === null || task.component.trim() === '' ? null : task.component,
        labels: task.labels,
        estimate: task.estimate,
      })
    }
    await setParent(db, project, task.number, own(task.parent)?.number ?? null)
    await save({ ref: task.ref, number: task.number, stage: 'created', done: 0, files: {}, changes: 0, seen: null })
  }

  for (const { task, row } of at('created')) {
    await linkTask(db, project, task, own)
    await save({ ...row, stage: 'linked', done: 0 })
  }

  for (const { task, row } of at('linked')) {
    await attach(task, row)
    await rewriteDescription(db, project, task.number, pictured(task.description, task.images, rows.get(task.ref)!.files, nameOf(keyOf(task))))
    await save({ ...rows.get(task.ref)!, stage: 'attached', done: 0 })
  }

  for (const { task, row } of at('attached')) {
    await journal(task, row, 0)
    await save({ ...rows.get(task.ref)!, stage: 'journaled', done: 0 })
  }

  for (const { task, row } of at('journaled')) {
    await history(task, row)
    await save({ ...rows.get(task.ref)!, stage: 'done', done: 0 })
  }

  if (!sync) return taken
  for (const { task, row } of at('done')) {
    // A task the stages above took now has all the source gave.
    if (!throughBefore.has(task.ref) || unchanged(task, row)) continue
    await setFields(db, project, task, own(task.parent)?.number ?? null, storeAt(Date.now()))
    await linkTask(db, project, task, own)
    await attach(task, row)
    const fresh = rows.get(task.ref)!
    await rewriteDescription(db, project, task.number, pictured(task.description, task.images, fresh.files, nameOf(keyOf(task))))
    await journal(task, fresh, (await storeAt(Date.now()).comments(keyOf(task))).length)
    await history(task, rows.get(task.ref)!)
    await save({ ...rows.get(task.ref)!, stage: 'done', done: 0 })
    run.progress?.(++through, taken)
  }
  return taken

  /** Attaches the files not attached yet, by their key; a repeat goes on after the last one saved. */
  async function attach(task: ImportTask, row: ImportRow): Promise<void> {
    if (run.filesDir === undefined) return
    const files = new BuiltinFiles(storeAt(task.createdAt), run.filesDir, say)
    let current = row
    for (const file of await source.files(task.ref)) {
      if (Object.hasOwn(current.files, file.key)) continue
      let bytes: Uint8Array | ImportGone
      try {
        bytes = await file.read()
      } catch (error) {
        throw new Error(`${task.id}: the attachment ${file.name}`, { cause: error })
      }
      if (!(bytes instanceof Uint8Array)) {
        say(`import: ${task.id}: the attachment ${file.name} has no file and is not imported: ${bytes.gone}`)
        current = { ...current, files: { ...current.files, [file.key]: GONE } }
        await save(current)
        continue
      }
      const made = await files.add(keyOf(task), { name: file.name, type: file.type, bytes })
      current = { ...current, files: { ...current.files, [file.key]: made.sha256 } }
      await save(current)
    }
  }

  /** Posts the comments from `from` on, or from the row's progress when it is further. */
  async function journal(task: ImportTask, row: ImportRow, from: number): Promise<void> {
    const comments = await source.comments(task.ref)
    const named = new Map((await source.files(task.ref)).map((file) => [file.key, file.name]))
    for (let index = Math.max(from, row.done); index < comments.length; index += 1) {
      const comment = comments[index]!
      const { by, name } = importedAuthor(comment.author, run.authors)
      const body = commentBody(comment, rows.get(task.ref)!.files, named, nameOf(keyOf(task)))
      await storeAt(comment.at).comment(keyOf(task), by, body, null, name)
      if (from === 0) await save({ ...rows.get(task.ref)!, done: index + 1 })
    }
  }

  /** Writes the change log after the entries written already; a tracker without one gives the closing time alone. */
  async function history(task: ImportTask, row: ImportRow): Promise<void> {
    if (source.changes === undefined) {
      if (row.changes > 0 || task.closedAt === null || isOpen(task.status)) return
      await writeChanges(db, project, task.number, [{ at: task.closedAt, author: SERVICE_AUTHOR, field: 'status', from: null, to: importedStatus(task.status).name }])
      await save({ ...row, changes: 1 })
      return
    }
    const changes = withBefore(await source.changes(task.ref)).slice(row.changes)
    if (changes.length === 0) return
    await writeChanges(db, project, task.number, changes.map((change) => ({ ...change, author: writer(change.author) })))
    await save({ ...rows.get(task.ref)!, changes: row.changes + changes.length })
  }
}

/** The text with each picture's `ref` turned into the address of its attachment; a picture not attached stays as it was. */
export function pictured(text: string, images: readonly ImportImage[], files: Readonly<Record<string, string>>, task: string): string {
  let result = text
  for (const image of images) {
    const sha = files[image.file]
    if (sha !== undefined && sha !== GONE && image.ref !== '') result = result.split(image.ref).join(fileUrl(task, sha))
  }
  return result
}

/** A comment's text with its pictures pointing at the attachments and a link to each other file it carried. */
export function commentBody(comment: ImportComment, files: Readonly<Record<string, string>>, names: ReadonlyMap<string, string>, task: string): string {
  const text = pictured(comment.body, comment.images, files, task)
  const shown = new Set(comment.images.map((image) => image.file))
  const links = comment.files.flatMap((key) => {
    const sha = files[key]
    return shown.has(key) || sha === undefined || sha === GONE ? [] : [`[${names.get(key) ?? key}](${fileUrl(task, sha)})`]
  })
  return links.length === 0 ? text : `${text}\n\n${links.join('\n')}`
}

/**
 * The source's milestones before the tasks, so a task finds its own (BTN-1436); the last pass sets an existing one's
 * fields again. A closed milestone the source gives no closing time of takes the last closing of its tasks.
 */
async function importMilestones(db: Db, project: string, milestones: readonly ImportMilestone[], tasks: readonly ImportTask[], update: boolean): Promise<void> {
  const stamp = { at: new Date().toISOString(), writer: writerOf(SERVICE_AUTHOR) }
  for (const milestone of milestones) {
    if (milestone.name.trim() === '') continue
    const closings = tasks.flatMap((task) => (task.closedAt !== null && task.milestone !== null && sameName(task.milestone, milestone.name) ? [task.closedAt] : []))
    const closedAt = milestone.closedAt ?? (closings.length === 0 ? null : Math.max(...closings))
    const { name, date, status, description } = milestone
    await inTransaction(db, (tx) => importMilestone(tx, stamp, project, { name, date, status, description, closedAt: closedAt === null ? null : new Date(closedAt).toISOString() }, update))
  }
}

const rowOf = async (tx: Pick<Db, 'query'>, project: string, number: number) =>
  (await tx.query<{ id: string }>('select id from builtin_tasks where project_id = $1 and number = $2', [project, number])).rows[0]?.id

/** Sets the parent with no history: the source's change log carries it. */
async function setParent(db: Db, project: string, number: number, parent: number | null): Promise<void> {
  await db.query(
    `update builtin_tasks set parent_id = (select id from builtin_tasks where project_id = $1 and number = $3) where project_id = $1 and number = $2`,
    [project, number, parent],
  )
}

/**
 * The task's links to the other imported tasks, written as they are: no loop or milestone check, which the source did
 * not hold them to, and no history. Both its sides, so that a task the last pass takes brings a link the other task of
 * the pair did not change for (BTN-1432); a pair already there is not written twice.
 */
async function linkTask(db: Db, project: string, task: ImportTask, own: (link: ImportLink | null) => ImportTask | null): Promise<void> {
  await inTransaction(db, async (tx) => {
    const id = await rowOf(tx, project, task.number)
    if (id === undefined) return
    const write = async (other: ImportTask, kind: 'blocks' | 'blockedBy' | 'relates') => {
      const otherId = await rowOf(tx, project, other.number)
      if (otherId === undefined || otherId === id) return
      const [a, b] = kind === 'blockedBy' || (kind === 'relates' && otherId < id) ? [otherId, id] : [id, otherId]
      await tx.query('insert into builtin_relations (from_id, to_id, kind) values ($1, $2, $3) on conflict do nothing', [a, b, kind === 'relates' ? 'relates' : 'blocks'])
    }
    for (const link of task.blocks) if (own(link) !== null) await write(own(link)!, 'blocks')
    for (const link of task.blockedBy) if (own(link) !== null) await write(own(link)!, 'blockedBy')
    for (const link of task.related) if (own(link) !== null) await write(own(link)!, 'relates')
  })
}

/** The description with its pictures pointing at their attachments, with no history: it is the source's text. */
async function rewriteDescription(db: Db, project: string, number: number, text: string): Promise<void> {
  await db.query('update builtin_tasks set description = $3 where project_id = $1 and number = $2 and description <> $3', [project, number, text])
}

interface WrittenChange {
  at: number
  author: ChangeAuthor
  field: Parameters<typeof logTask>[4][number]['field']
  from: string | null
  to: string | null
}

async function writeChanges(db: Db, project: string, number: number, changes: readonly WrittenChange[]): Promise<void> {
  await inTransaction(db, async (tx) => {
    const id = await rowOf(tx, project, number)
    if (id === undefined) return
    for (const change of changes) {
      const author = change.author
      await logTask(tx, new Date(change.at).toISOString(), [author.by, null, author.name ?? null], { id, project_id: project }, [
        { field: change.field, before: change.from, after: change.to },
      ])
    }
  })
}

/** The last pass's fields: the source's values over the imported ones, with no history (its change log brings it). */
async function setFields(db: Db, project: string, task: ImportTask, parent: number | null, store: BuiltinStore): Promise<void> {
  const stamp = { at: new Date().toISOString(), writer: writerOf(SERVICE_AUTHOR) }
  await inTransaction(db, async (tx: Transaction) => {
    const milestone = task.milestone === null || task.milestone.trim() === '' ? null : await milestoneIdOf(tx, stamp, project, task.milestone)
    const component = task.component === null || task.component.trim() === '' ? null : await componentIdOf(tx, stamp, project, task.component, true)
    await tx.query(
      `update builtin_tasks set title = $3, status = $4, priority = $5, estimate = $6, milestone_id = $7, component_id = $8
        where project_id = $1 and number = $2`,
      [project, task.number, task.title.trim() === '' ? task.id : task.title.trim(), importedStatus(task.status).name, task.priority, estimateOf(task.estimate), milestone, component],
    )
  })
  await setParent(db, project, task.number, parent)
  const key = { project, number: task.number }
  const had = (await store.get(key))?.labels ?? []
  const lower = new Set(task.labels.map((name) => name.trim().toLocaleLowerCase()))
  await store.relabel(key, { add: task.labels, remove: had.filter((name) => !lower.has(name.toLocaleLowerCase())) })
}
