import { sameName } from '../chain/rules.js'
import type { Notice } from '../notice/notice.js'
import type { TaskDraft, TaskEditor } from './editor.js'
import { isOpen, type TaskPriority, type TaskStatus } from './model.js'
import type { TrackerVocabulary } from './source.js'

/**
 * The copy of a project's tasks into another tracker (BTN-1073), on the target's `TaskEditor` alone: one code for every
 * tracker with an editor. The source is the built-in tracker (`src/builtin/export.ts`); the progress is kept by
 * `ExportLog`, so a repeat goes on from where a failure stopped it and a finished copy creates nothing again.
 */

export interface ExportComment {
  author: 'person' | 'agent' | 'service'
  /** `<Provider> | <model>` of an agent's session, if known. */
  model: string | null
  body: string
  /** ISO time. */
  at: string
}

export interface ExportFile {
  name: string
  type: string
  /** The bytes; `null` — they are gone. */
  read(): Promise<Uint8Array | null>
}

export interface ExportTask {
  /** The source's own id of the task: the progress is kept by it. */
  ref: string
  number: number
  /** The task's id as the page shows it. */
  id: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  milestone: string | null
  labels: string[]
  /** Minutes of the agent's work. */
  estimate: number | null
  /** The parent's `ref`. */
  parent: string | null
  /** `ref`s of the tasks it blocks; a task of another project is a `ref` no task of the list has. */
  blocks: string[]
  related: string[]
  /** How many attachments it has. */
  files: number
}

export interface ExportSource {
  /** Every task of the project, closed ones too: a link or a parent among them stays behind. */
  tasks(): Promise<ExportTask[]>
  /** The journal, oldest first. */
  comments(ref: string): Promise<ExportComment[]>
  files(ref: string): Promise<ExportFile[]>
  /** Notes in the old task's journal that it moved to `key`; a note there already is not written again. */
  mark(ref: string, key: string, url: string | null): Promise<void>
}

export interface ExportTarget {
  /** The project's id as the target's editor takes it. */
  project: string
  editor: TaskEditor
  /** `null` — the tracker gives none: no label, milestone or status is sent. */
  vocabulary: TrackerVocabulary | null
  url(key: string): string | null
}

/** Each task's last finished stage; `pending` — its marker is saved and the create may have happened. */
export const EXPORT_STAGES = ['pending', 'created', 'linked', 'attached', 'journaled', 'marked'] as const
export type ExportStage = (typeof EXPORT_STAGES)[number]

export interface ExportRow {
  ref: string
  number: number
  /** The new task's id; `null` — not created yet. */
  key: string | null
  url: string | null
  stage: ExportStage
  /** The marker its create went with (`TaskEditor.markers`); `null` — the target has none. */
  marker: string | null
  /** Files attached or comments posted of the stage after `stage`. */
  done: number
}

export interface ExportLog {
  rows(): Promise<ExportRow[]>
  save(row: ExportRow): Promise<void>
}

export type ExportLossKind = 'priority' | 'estimate' | 'blocks' | 'relates' | 'files' | 'labels' | 'milestones' | 'status' | 'parent' | 'links' | 'markers'

/** What the copy leaves behind: the tasks it concerns by id, the labels, milestones or statuses by name. */
export interface ExportLoss {
  kind: ExportLossKind
  tasks: string[]
  names: string[]
}

export interface ExportPlan {
  /** The tasks to copy, parents first; `status` — the one they get there, `null` — the tracker's default. */
  tasks: { id: string; title: string; status: string | null }[]
  losses: ExportLoss[]
}

/** The target's status of the same category: of the same name ignoring case, else the first; `null` — none of it. */
export function statusFor(status: TaskStatus, statuses: readonly TaskStatus[]): string | null {
  const same = statuses.filter((each) => each.category === status.category)
  return (same.find((each) => sameName(each.name, status.name)) ?? same[0])?.name ?? null
}

/** What the target keeps of a task. */
interface Kept {
  priority: boolean
  estimate: boolean
  blocks: boolean
  relates: boolean
  files: boolean
  markers: boolean
  /** The target's spelling of a label or a milestone; `undefined` — it has none such. */
  label(name: string): string | undefined
  milestone(name: string): string | undefined
  status(status: TaskStatus): string | null
}

async function keptBy({ editor, vocabulary }: ExportTarget): Promise<Kept> {
  const types = editor.linkTypes ?? ['blocks', 'blockedBy', 'relates']
  const blocking = editor.blockingLinks === undefined ? true : await editor.blockingLinks()
  const spelled = (names: readonly string[] | undefined) => (name: string) => names?.find((each) => sameName(each, name))
  return {
    priority: editor.priorities?.(vocabulary?.labels ?? []) ?? true,
    estimate: editor.estimate !== undefined && vocabulary?.estimate !== false,
    blocks: blocking && types.includes('blocks'),
    relates: types.includes('relates'),
    files: editor.files !== undefined,
    markers: editor.markers !== undefined,
    label: spelled(vocabulary?.labels),
    milestone: spelled(vocabulary?.milestones),
    status: (status) => (vocabulary === null ? null : statusFor(status, vocabulary.statuses)),
  }
}

/** Parents before their children, else by number. */
function parentsFirst(tasks: ExportTask[]): ExportTask[] {
  const byRef = new Map(tasks.map((each) => [each.ref, each]))
  const depth = (task: ExportTask): number => {
    let count = 0
    for (let up = task.parent; up !== null && byRef.has(up) && count < tasks.length; up = byRef.get(up)!.parent) count += 1
    return count
  }
  return [...tasks].sort((a, b) => depth(a) - depth(b) || a.number - b.number)
}

/** What a target would get and lose: nothing is written. */
export async function exportPlan(source: ExportSource, target: ExportTarget): Promise<ExportPlan> {
  const kept = await keptBy(target)
  const moving = parentsFirst((await source.tasks()).filter((task) => isOpen(task.status)))
  const refs = new Set(moving.map((task) => task.ref))
  const losses: ExportLoss[] = []
  const add = (kind: ExportLossKind, which: (task: ExportTask) => boolean, names: (task: ExportTask) => string[] = () => []) => {
    const tasks = moving.filter(which)
    const all = [...new Set(tasks.flatMap(names))]
    if (tasks.length > 0) losses.push({ kind, tasks: tasks.map((task) => task.id), names: all })
  }
  if (!kept.priority) add('priority', (task) => task.priority !== 'none')
  if (!kept.estimate) add('estimate', (task) => task.estimate !== null)
  if (!kept.blocks) add('blocks', (task) => task.blocks.some((ref) => refs.has(ref)))
  if (!kept.relates) add('relates', (task) => task.related.some((ref) => refs.has(ref)))
  if (!kept.files) add('files', (task) => task.files > 0)
  const lostLabels = (task: ExportTask) => task.labels.filter((name) => kept.label(name) === undefined)
  add('labels', (task) => lostLabels(task).length > 0, lostLabels)
  const lostMilestone = (task: ExportTask) => (task.milestone !== null && kept.milestone(task.milestone) === undefined ? [task.milestone] : [])
  add('milestones', (task) => lostMilestone(task).length > 0, lostMilestone)
  add('status', (task) => kept.status(task.status) === null, (task) => [task.status.name])
  add('parent', (task) => task.parent !== null && !refs.has(task.parent))
  add('links', (task) => [...task.blocks, ...task.related].some((ref) => !refs.has(ref)))
  if (!kept.markers) losses.push({ kind: 'markers', tasks: [], names: [] })
  return { tasks: moving.map((task) => ({ id: task.id, title: task.title, status: kept.status(task.status) })), losses }
}

export interface ExportRun {
  source: ExportSource
  target: ExportTarget
  log: ExportLog
  /** A line of the service log, in English. */
  say?: (line: string) => void
}

/**
 * Copies the project's open tasks by stages: the tasks, parents first; the links between the copied ones; the
 * attachments; the journal; the note in each old task. A failed write throws and stops it; the repeat takes each task
 * from the stage it reached. A task copied once stays in the copy even when it was closed since.
 */
export async function runExport({ source, target, log, say = () => {} }: ExportRun): Promise<void> {
  const { editor, project } = target
  const kept = await keptBy(target)
  const rows = new Map((await log.rows()).map((row) => [row.ref, row]))
  const moving = parentsFirst((await source.tasks()).filter((task) => rows.has(task.ref) || isOpen(task.status)))
  const save = async (row: ExportRow) => {
    rows.set(row.ref, row)
    await log.save(row)
  }
  const keyOf = (ref: string) => rows.get(ref)?.key ?? null
  const at = (stage: ExportStage) => moving.flatMap((task) => (rows.get(task.ref)?.stage === stage ? [{ task, row: rows.get(task.ref)! }] : []))

  for (const task of moving) {
    const row = rows.get(task.ref)
    if (row !== undefined && row.key !== null) continue
    if (row?.marker != null && editor.markers !== undefined) {
      const found = await editor.markers.find(project, row.marker)
      if (found !== null) {
        await save({ ...row, key: found, url: target.url(found), stage: 'created', done: 0 })
        continue
      }
    }
    const marker = row?.marker ?? editor.markers?.make() ?? null
    const pending: ExportRow = { ref: task.ref, number: task.number, key: null, url: null, stage: 'pending', marker, done: 0 }
    await save(pending)
    const key = await editor.create(project, draftOf(task, kept, task.parent === null ? null : keyOf(task.parent)), [], marker ?? undefined)
    await save({ ...pending, key, url: target.url(key), stage: 'created' })
  }

  for (const { task, row } of at('created')) {
    // A link is no error when it is there already: the repeat of a task's links writes them all again.
    if (kept.blocks) for (const other of task.blocks) await linked(row.key!, keyOf(other), 'blocks')
    if (kept.relates) for (const other of task.related) if (task.ref < other) await linked(row.key!, keyOf(other), 'relates')
    await save({ ...row, stage: 'linked', done: 0 })
  }

  for (const { task, row } of at('linked')) {
    const files = editor.files === undefined ? [] : await source.files(task.ref)
    for (let index = row.done; index < files.length; index += 1) {
      const file = files[index]!
      const bytes = await file.read()
      if (bytes === null) say(`export: ${task.id}: the attachment ${file.name} has no file and is not copied`)
      else await editor.files!.attach(row.key!, [{ name: file.name, type: file.type, bytes }])
      await save({ ...row, done: index + 1 })
    }
    await save({ ...rows.get(task.ref)!, stage: 'attached', done: 0 })
  }

  for (const { task, row } of at('attached')) {
    const comments = await source.comments(task.ref)
    for (let index = row.done; index < comments.length; index += 1) {
      await editor.comment(row.key!, journalEntry(comments[index]!), null)
      await save({ ...row, done: index + 1 })
    }
    await save({ ...rows.get(task.ref)!, stage: 'journaled', done: 0 })
  }

  for (const { task, row } of at('journaled')) {
    await source.mark(task.ref, row.key!, row.url)
    await save({ ...row, stage: 'marked', done: 0 })
  }

  async function linked(key: string, other: string | null, link: 'blocks' | 'relates') {
    if (other !== null) await editor.link(key, other, link, true)
  }
}

function draftOf(task: ExportTask, kept: Kept, parent: string | null): TaskDraft {
  return {
    title: task.title,
    description: task.description,
    status: kept.status(task.status),
    priority: kept.priority && task.priority !== 'none' ? task.priority : null,
    milestone: task.milestone === null ? null : (kept.milestone(task.milestone) ?? null),
    labels: task.labels.flatMap((name) => kept.label(name) ?? []),
    parent,
    ...(kept.estimate && task.estimate !== null ? { estimate: task.estimate } : {}),
  }
}

/**
 * A journal entry as a comment of the target: the target names the token's account as its author, so the text starts
 * with who wrote it and when.
 */
export function journalEntry(comment: ExportComment): string {
  const who = comment.author === 'person' ? 'Person' : comment.author === 'service' ? 'Even Keel' : comment.model === null ? 'Agent' : `Agent (${comment.model})`
  const when = new Date(comment.at).toISOString().slice(0, 16).replace('T', ' ')
  return `${who}, ${when} UTC:\n\n${comment.body}`
}

/** How many tasks of the copy reached each stage. */
/** Where a project's tasks are copied (BTN-1073): the fields of the wizard's tracker step. */
export interface ExportTargetFields {
  /** The tracker profile's id. */
  profile: string
  /** The project in the tracker (`trackerProject`); empty where the tracker needs none. */
  place: string
  key: string
}

/** A project's copy as the page sees it (`builtin/export/state`); here, not in `src/builtin/`, so the page's types stay off the service's code. */
export interface ExportState {
  target: ExportTargetFields | null
  running: boolean
  startedAt: string | null
  finishedAt: string | null
  /** How many tasks reached each stage; `tasks` — those the copy took up so far. */
  progress: ReturnType<typeof progressOf>
  /** The tasks the copy is to take: the open ones and those it took that are closed since — the "M" of the page's "N of M". */
  total: number
  /** Why the last run stopped; `null` — it did not, or none ran since the start of the service. */
  failed: Notice | null
}

export function progressOf(rows: readonly ExportRow[]): { tasks: number } & Record<Exclude<ExportStage, 'pending'>, number> {
  const reached = (stage: ExportStage) => rows.filter((row) => EXPORT_STAGES.indexOf(row.stage) >= EXPORT_STAGES.indexOf(stage)).length
  return { tasks: rows.length, created: reached('created'), linked: reached('linked'), attached: reached('attached'), journaled: reached('journaled'), marked: reached('marked') }
}
