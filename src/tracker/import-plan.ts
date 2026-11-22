import { BUILTIN_STATUSES } from '../builtin/model.js'
import type { ExportCounts, ExportLoss, ExportLossKind, ExportPlan, ExportStatusRow } from './export.js'
import { statusFor } from './export.js'
import type { ChangeBy } from './history.js'
import type { ImportAuthor, ImportAuthorKind, ImportMilestone, ImportSource, ImportTask } from './import.js'
import type { StatusCategory, TaskStatus } from './model.js'
import type { Notice } from '../notice/notice.js'
import type { TransferCheck } from './transfer-check.js'

/**
 * The plan of the import of a project's whole history into the built-in tracker (BTN-1405): what moves by kind, the
 * statuses the tasks get, the authors with what each becomes, and what stays behind. Nothing is written. Types and pure
 * code only: the page takes them too.
 */

export interface ImportCounts extends ExportCounts {
  components: number
  /** Entries of the change log; 0 where the tracker gives none. */
  changes: number
}

/** An author of tasks, comments and changes, as the source marks them, and what the import writes them as. */
export interface ImportPlanAuthor {
  kind: ImportAuthorKind
  name: string | null
  /** The tasks the author created: not among `changes`, as the plan's own count of changes has no creations (BTN-1429). */
  tasks: number
  comments: number
  changes: number
  as: ImportAuthorKind
}

/** The person's pick for one author of the plan: `kind` and `name` as the source marks it. */
export interface ImportAuthorChoice {
  kind: ImportAuthorKind
  name: string | null
  as: ImportAuthorKind
}

/** Every task moves, closed ones too; a status always has its group in the built-in tracker. */
export interface ImportPlan extends ExportPlan {
  counts: ImportCounts
  /** By how much each wrote, the most first. */
  authors: ImportPlanAuthor[]
}

/** A project's import as the page sees it (`builtin/import/state`). */
export interface ImportState {
  /** The tracker the import reads; `null` — none began. */
  from: { tracker: string; place: string; key: string } | null
  authors: ImportAuthorChoice[]
  running: boolean
  startedAt: string | null
  finishedAt: string | null
  /** How many tasks reached each stage; `tasks` — those the import took up so far. */
  progress: { tasks: number; created: number; linked: number; attached: number; journaled: number; done: number }
  /** The tasks of the plan: the "M" of the page's "N of M". */
  total: number
  /** Why the last run stopped; `null` — it did not, or none ran since the start of the service. */
  failed: Notice | null
  /** The check after the last run; `null` — none yet. */
  check: TransferCheck | null
  checkFailed: Notice | null
  /** The check after a run going on (BTN-1461): `done` tasks of the `total` counted again; `null` — none. */
  checking: ImportPlanning | null
  /** The switch going on (BTN-1432); `null` — none. */
  switching: ImportSwitching | null
  /** The plan's read of the source going on (BTN-1452); `null` — none. */
  planning: ImportPlanning | null
}

/** The plan's read: `done` tasks of the `total` the source gave; `total` is 0 until it gave its list. */
export interface ImportPlanning {
  done: number
  total: number
}

/** How many tasks the plan reads at once where the source names no number of its own (`ImportSource.parallel`). */
export const PLAN_PARALLEL = 4

/**
 * The step of a switch: `pass` — the last pass over what changed in the source (`total` — the tasks it takes), `check`
 * — the check counted again (`total` — every task), `switch` — the project moves onto the built-in tracker.
 */
export interface ImportSwitching {
  stage: 'pass' | 'check' | 'switch'
  done: number
  total: number
}

/** The source's task as the import reads it, with the author of each entry of its journal and change log. */
export interface CountedTask {
  task: ImportTask
  comments: (ImportAuthor | null)[]
  changes: (ImportAuthor | null)[]
  files: number
}

const CATEGORIES: readonly StatusCategory[] = ['UnStarted', 'ToDo', 'Active', 'Won', 'Lost']

/** The built-in status a task gets: of the same group, of the same name ignoring case, else the group's first. */
export function importedStatus(status: TaskStatus): TaskStatus {
  const name = statusFor(status, BUILTIN_STATUSES)
  return BUILTIN_STATUSES.find((each) => each.name === name) ?? BUILTIN_STATUSES[1]!
}

const authorKey = (kind: ImportAuthorKind, name: string | null) => `${kind}\u0000${name ?? ''}`

/**
 * Who an entry is written as in the built-in tracker: the agent without a model, the user as the person of the page,
 * another person as a person with the tracker's name. The plan's picks go over the source's marking; an author the
 * source does not name is the user's.
 */
export function importedAuthor(author: ImportAuthor | null, choices: readonly ImportAuthorChoice[]): { by: ChangeBy; name: string | null } {
  if (author === null) return { by: 'person', name: null }
  const as = choices.find((each) => authorKey(each.kind, each.name) === authorKey(author.kind, author.name))?.as ?? author.kind
  if (as === 'agent') return { by: 'agent', name: null }
  return as === 'user' ? { by: 'person', name: null } : { by: 'person', name: author.name }
}

/** Parents before their children, else by number; a parent of another project counts as none. */
export function importOrder<T extends { task: ImportTask }>(tasks: readonly T[]): T[] {
  const byRef = new Map(tasks.map((each) => [each.task.ref, each.task]))
  const up = (task: ImportTask) => (task.parent === null || task.parent.foreign ? null : (byRef.get(task.parent.ref) ?? null))
  const depth = (task: ImportTask): number => {
    let count = 0
    for (let parent = up(task); parent !== null && count < tasks.length; parent = up(parent)) count += 1
    return count
  }
  return [...tasks].sort((a, b) => depth(a.task) - depth(b.task) || a.task.number - b.task.number)
}

/**
 * Reads each task's journal, change log and files to count them, `source.parallel` tasks at once; `progress` hears the
 * tasks read so far of the list. The first failure stops the read.
 */
export async function countTasks(source: ImportSource, progress?: (done: number, total: number) => void): Promise<CountedTask[]> {
  return readTasks(source, await source.tasks(), progress, async (task) => {
    const [comments, changes, files] = await Promise.all([source.comments(task.ref), source.changes?.(task.ref) ?? [], source.files(task.ref)])
    return { task, comments: comments.map((each) => each.author), changes: changes.map((each) => each.author), files: files.length }
  })
}

/**
 * `read` of each task, `source.parallel` tasks at once (`PLAN_PARALLEL` where absent), the answers in the order of
 * `tasks`; `progress` hears how many are through. The first failure stops the read: no task is begun after it.
 */
export async function readTasks<T>(
  source: Pick<ImportSource, 'parallel'>,
  tasks: readonly ImportTask[],
  progress: ((done: number, total: number) => void) | undefined,
  read: (task: ImportTask) => Promise<T>,
): Promise<T[]> {
  const answers = new Array<T>(tasks.length)
  let next = 0
  let done = 0
  let failed = false
  progress?.(0, tasks.length)
  const worker = async () => {
    while (!failed && next < tasks.length) {
      const index = next++
      try {
        answers[index] = await read(tasks[index]!)
      } catch (error) {
        failed = true
        throw error
      }
      progress?.((done += 1), tasks.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, source.parallel ?? PLAN_PARALLEL), tasks.length) }, worker))
  return answers
}

/**
 * What the import would write: nothing is. `choices` — the authors as the person picked them so far; `milestones` — the
 * source's, those without tasks count too. The milestone fields the source does not keep are a loss of `milestones`
 * whose names are the fields (`ImportMilestoneField`).
 */
export function importPlan(
  source: Pick<ImportSource, 'changes' | 'timeReports' | 'milestoneGaps'>,
  counted: readonly CountedTask[],
  choices: readonly ImportAuthorChoice[] = [],
  milestones: readonly ImportMilestone[] = [],
): ImportPlan {
  const moving = importOrder(counted)
  const refs = new Set(moving.map((each) => each.task.ref))
  const own = (link: { ref: string; foreign: boolean }) => !link.foreign && refs.has(link.ref)
  const losses: ExportLoss[] = []
  const add = (kind: ExportLossKind, which: (task: ImportTask) => string[]) => {
    const tasks = moving.filter((each) => which(each.task).length > 0)
    if (tasks.length > 0) losses.push({ kind, tasks: tasks.map((each) => each.task.id), names: [...new Set(tasks.flatMap((each) => which(each.task)))] })
  }
  add('links', (task) => [...task.blocks, ...task.blockedBy, ...task.related].filter((link) => !own(link)).map((link) => link.id))
  add('parent', (task) => (task.parent !== null && !own(task.parent) ? [task.parent.id] : []))
  if (source.changes === undefined) losses.push({ kind: 'history', tasks: [], names: [] })
  if (source.timeReports === true) losses.push({ kind: 'timeReports', tasks: [], names: [] })
  if ((source.milestoneGaps ?? []).length > 0) losses.push({ kind: 'milestones', tasks: [], names: [...source.milestoneGaps!] })
  const sum = (count: (each: CountedTask) => number) => moving.reduce((total, each) => total + count(each), 0)
  const distinct = (names: (task: ImportTask) => (string | null)[], more: readonly string[] = []) =>
    new Set([...moving.flatMap((each) => names(each.task)), ...more].flatMap((name) => (name === null || name.trim() === '' ? [] : [name.trim().toLocaleLowerCase()]))).size
  const counts: ImportCounts = {
    tasks: moving.length,
    comments: sum((each) => each.comments.length),
    files: sum((each) => each.files),
    blocks: sum((each) => each.task.blocks.filter(own).length),
    relates: sum((each) => each.task.related.filter((link) => own(link) && each.task.ref < link.ref).length),
    subtasks: moving.filter((each) => each.task.parent !== null && own(each.task.parent)).length,
    milestones: distinct((task) => [task.milestone], milestones.map((each) => each.name)),
    labels: distinct((task) => task.labels),
    components: distinct((task) => [task.component]),
    changes: sum((each) => each.changes.length),
  }
  return {
    tasks: moving.map(({ task }) => ({ id: task.id, title: task.title, status: importedStatus(task.status).name })),
    counts,
    statuses: statusesOf(moving.map((each) => each.task)),
    losses,
    authors: authorsOf(moving, choices),
  }
}

function authorsOf(moving: readonly CountedTask[], choices: readonly ImportAuthorChoice[]): ImportPlanAuthor[] {
  const authors = new Map<string, ImportPlanAuthor>()
  const count = (author: ImportAuthor | null, field: 'tasks' | 'comments' | 'changes') => {
    if (author === null) return
    const key = authorKey(author.kind, author.name)
    const row = authors.get(key) ?? { kind: author.kind, name: author.name, tasks: 0, comments: 0, changes: 0, as: author.kind }
    row[field] += 1
    authors.set(key, row)
  }
  for (const each of moving) {
    for (const author of each.comments) count(author, 'comments')
    for (const author of each.changes) count(author, 'changes')
    count(each.task.createdBy, 'tasks')
  }
  for (const choice of choices) {
    const row = authors.get(authorKey(choice.kind, choice.name))
    if (row !== undefined) row.as = choice.as
  }
  const total = (author: ImportPlanAuthor) => author.tasks + author.comments + author.changes
  return [...authors.values()].sort((a, b) => total(b) - total(a))
}

function statusesOf(tasks: readonly ImportTask[]): ExportStatusRow[] {
  const rows = new Map<string, ExportStatusRow>()
  for (const task of tasks) {
    const key = `${task.status.category}\u0000${task.status.name}`
    const row = rows.get(key)
    if (row !== undefined) row.tasks += 1
    else rows.set(key, { name: task.status.name, category: task.status.category, tasks: 1, target: importedStatus(task.status) })
  }
  return [...rows.values()].sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category))
}
