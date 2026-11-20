import { sameName } from '../chain/rules.js'
import type { TrackerCard } from './card.js'
import { journalEntry, keptBy, runExport, type ExportLog, type ExportPlan, type ExportRow, type ExportRun, type ExportSource, type ExportTarget, type ExportTask, type Kept } from './export.js'
import { isOpen } from './model.js'
import { TrackerNotFound } from './source.js'

/**
 * The check at the end of a transfer (BTN-1291): both sides counted again, a row a kind. The source side is what the
 * transfer was to take — only the kinds the target keeps, so the plan's losses are not counted again; the target side
 * is read from the created tasks themselves. A task counts no more there than it was to get: a comment or a label someone
 * added there hides no missing one.
 */

/** `history` is the import's (BTN-1079): the copy into another tracker takes no change history over. */
export const CHECK_KINDS = ['tasks', 'comments', 'history', 'files', 'links', 'milestones', 'labels', 'components'] as const
export type CheckKind = (typeof CHECK_KINDS)[number]

export interface CheckRow {
  kind: CheckKind
  /** How many the source has of it: what the transfer was to take. */
  source: number
  /** How many of those the target has. */
  target: number
  /** The source's ids of the tasks short of it in the target. */
  tasks: string[]
}

export interface TransferCheck {
  /** ISO time of the count. */
  at: string
  rows: CheckRow[]
}

export type TransferDirection = 'export' | 'import'

/** A finished transfer as it stood when the project switched (BTN-1291): kept as long as the project. */
export interface TransferReport {
  id: string
  project: string
  direction: TransferDirection
  /** The adapter kind of the other tracker: the target of an export, the source of an import. */
  tracker: string
  place: string
  key: string
  /** The project's key before the switch. */
  sourceKey: string | null
  /** The switch of the closed tasks (BTN-1289); `false` until it exists. */
  closed: boolean
  history: boolean
  startedAt: string
  finishedAt: string | null
  switchedAt: string
  plan: ExportPlan
  check: TransferCheck
  matched: boolean
}

/** A row of the project's list of transfers. */
export type TransferSummary = Pick<TransferReport, 'id' | 'direction' | 'tracker' | 'switchedAt' | 'matched'> & { tasks: number }

/** Every row as many on both sides, no task short. */
export const checkMatched = (check: TransferCheck): boolean => check.rows.every((row) => row.tasks.length === 0 && row.target >= row.source)

/** A task of the check: what it was to get and what its copy has. */
interface Seen {
  task: ExportTask
  row: ExportRow | undefined
  /** `null` — not created there, or gone. */
  card: TrackerCard | null
  comments: number
  files: number
  labels: string[]
  milestone: string | null
  component: string | null
}

interface Inspection {
  kept: Kept
  seen: Seen[]
  /** Every link the copies were to get (`link`), once each, with the task that owns it. */
  links: Map<string, ExportTask>
  found: Set<string>
}

/** Counts both sides of a transfer from the source's tasks and the target's copies of them. */
export async function checkExport(source: ExportSource, target: ExportTarget, rows: readonly ExportRow[], now: () => Date = () => new Date()): Promise<TransferCheck> {
  const { kept, seen, links, found } = await inspect(source, target, rows)
  const row = (kind: CheckKind, count: (each: Seen) => [number, number]): CheckRow => {
    let [here, there] = [0, 0]
    const short: string[] = []
    for (const each of seen) {
      const [want, got] = count(each)
      here += want
      there += Math.min(want, got)
      if (got < want) short.push(each.task.id)
    }
    return { kind, source: here, target: there, tasks: short }
  }
  /** Names count once each; a name is there only on every task that was to get it. */
  const names = (kind: CheckKind, wanted: (each: Seen) => string[], has: (each: Seen, name: string) => boolean): CheckRow => {
    const all = new Map<string, boolean>()
    const short = new Set<string>()
    for (const each of seen) {
      for (const name of wanted(each)) {
        const key = name.toLowerCase()
        const ok = has(each, name)
        all.set(key, (all.get(key) ?? true) && ok)
        if (!ok) short.add(each.task.id)
      }
    }
    return { kind, source: all.size, target: [...all.values()].filter(Boolean).length, tasks: [...short] }
  }
  const rowsOf: CheckRow[] = [
    row('tasks', (each) => [1, each.card === null ? 0 : 1]),
    row('comments', (each) => [each.task.comments, each.comments]),
  ]
  if (kept.files) rowsOf.push(row('files', (each) => [each.task.files, each.files]))
  const owned = [...links.entries()]
  rowsOf.push({
    kind: 'links',
    source: owned.length,
    target: owned.filter(([each]) => found.has(each)).length,
    tasks: [...new Set(owned.filter(([each]) => !found.has(each)).map(([, task]) => task.id))],
  })
  if (target.vocabulary?.milestones !== undefined) {
    rowsOf.push(names('milestones', (each) => milestoneOf(each.task, kept), (each, name) => each.milestone !== null && sameName(each.milestone, name)))
  }
  rowsOf.push(names('labels', (each) => labelsOf(each.task, kept), (each, name) => each.labels.some((label) => sameName(label, name))))
  if (target.editor.components === true) {
    rowsOf.push(names('components', (each) => componentOf(each.task, kept), (each, name) => each.component !== null && sameName(each.component, name)))
  }
  return { at: now().toISOString(), rows: rowsOf }
}

/**
 * "Repeat" after a check that did not match. A task the target lacks goes back to `pending`, and `runExport` creates it
 * again with the open tasks filed since; then each copy short of something gets it — its missing links and parent, its
 * attachments and journal entries from where the target's end, its labels, milestone and component.
 */
export async function repairExport(run: ExportRun): Promise<void> {
  const { source, target, log, say = () => {} } = run
  for (const { row, card } of (await inspect(source, target, await log.rows())).seen) if (card === null && row?.key != null) await reset(log, row)
  await runExport(run)
  const rows = await log.rows()
  const { kept, seen, links, found } = await inspect(source, target, rows)
  const { editor } = target
  const keyOf = new Map(rows.flatMap((row) => (row.key === null ? [] : [[row.ref, row.key] as const])))
  for (const each of seen) {
    const { task, row, card } = each
    if (row?.key == null || card === null) continue
    const key = row.key
    for (const missing of [...links.keys()].filter((one) => links.get(one) === task && !found.has(one))) {
      const [kind, from, to] = parseLink(missing)
      const other = keyOf.get(kind === 'relates' && from !== task.ref ? from : to)
      if (other === undefined) continue
      if (kind === 'parent') await editor.set(key, { field: 'parent', to: other })
      else await editor.link(key, other, kind, true)
    }
    if (kept.files && each.files < task.files && editor.files !== undefined) {
      for (const file of (await source.files(task.ref)).slice(each.files)) {
        const bytes = await file.read()
        if (bytes === null) say(`export: ${task.id}: the attachment ${file.name} has no file and is not copied`)
        else await editor.files.attach(key, [{ name: file.name, type: file.type, bytes }])
      }
    }
    if (each.comments < task.comments) {
      for (const comment of (await source.comments(task.ref)).slice(each.comments)) await editor.comment(key, journalEntry(comment), null)
    }
    const labels = labelsOf(task, kept).filter((name) => !each.labels.some((label) => sameName(label, name)))
    if (labels.length > 0) await editor.relabel(key, { add: labels, remove: [] })
    const [milestone] = milestoneOf(task, kept)
    if (milestone !== undefined && (each.milestone === null || !sameName(each.milestone, milestone))) await editor.set(key, { field: 'milestone', to: milestone })
    const [component] = componentOf(task, kept)
    if (component !== undefined && (each.component === null || !sameName(each.component, component))) await editor.set(key, { field: 'component', to: component })
  }
}

async function reset(log: ExportLog, row: ExportRow): Promise<void> {
  await log.save({ ...row, key: null, url: null, stage: 'pending', done: 0 })
}

async function inspect(source: ExportSource, target: ExportTarget, rows: readonly ExportRow[]): Promise<Inspection> {
  const read = target.read
  if (read === undefined) throw new Error('the target tracker cannot read its tasks back')
  const kept = await keptBy(target)
  const byRef = new Map(rows.map((row) => [row.ref, row]))
  const tasks = (await source.tasks()).filter((task) => byRef.get(task.ref)?.key != null || isOpen(task.status))
  const refs = new Set(tasks.map((task) => task.ref))
  const refOfKey = new Map(rows.flatMap((row) => (row.key === null ? [] : [[row.key.toUpperCase(), row.ref] as const])))
  const links = new Map<string, ExportTask>()
  for (const task of tasks) {
    if (kept.blocks) for (const other of task.blocks) if (refs.has(other)) links.set(link('blocks', task.ref, other), task)
    if (kept.relates) for (const other of task.related) if (refs.has(other)) links.set(relates(task.ref, other), links.get(relates(task.ref, other)) ?? task)
    if (task.parent !== null && refs.has(task.parent)) links.set(link('parent', task.ref, task.parent), task)
  }
  const found = new Set<string>()
  const seen: Seen[] = []
  for (const task of tasks) {
    const row = byRef.get(task.ref)
    const card = row?.key == null || row.stage !== 'marked' ? null : await cardOf(read, row.key)
    if (card !== null) {
      const refOf = (ref: { id: string }) => refOfKey.get(ref.id.toUpperCase())
      for (const other of card.blocks) if (refOf(other) !== undefined) found.add(link('blocks', task.ref, refOf(other)!))
      for (const other of card.blockedBy) if (refOf(other) !== undefined) found.add(link('blocks', refOf(other)!, task.ref))
      for (const other of card.related) if (refOf(other) !== undefined) found.add(relates(task.ref, refOf(other)!))
      if (card.parent !== null && refOf(card.parent) !== undefined) found.add(link('parent', task.ref, refOf(card.parent)!))
    }
    seen.push({
      task,
      row,
      card,
      comments: card?.comments.length ?? 0,
      files: card?.attachments.length ?? 0,
      labels: card?.labels ?? [],
      milestone: card?.milestone?.label ?? null,
      component: card?.component ?? null,
    })
  }
  return { kept, seen, links, found }
}

async function cardOf(read: NonNullable<ExportTarget['read']>, key: string): Promise<TrackerCard | null> {
  try {
    return await read(key)
  } catch (error) {
    if (error instanceof TrackerNotFound) return null
    throw error
  }
}

type LinkKind = 'blocks' | 'relates' | 'parent'
const link = (kind: LinkKind, from: string, to: string) => JSON.stringify([kind, from, to])
const relates = (one: string, other: string) => (one < other ? link('relates', one, other) : link('relates', other, one))
const parseLink = (each: string) => JSON.parse(each) as [LinkKind, string, string]

const labelsOf = (task: ExportTask, kept: Kept): string[] => task.labels.flatMap((name) => kept.label(name) ?? [])
const milestoneOf = (task: ExportTask, kept: Kept): string[] => (task.milestone === null ? [] : [kept.milestone(task.milestone)].flatMap((name) => name ?? []))
const componentOf = (task: ExportTask, kept: Kept): string[] => (task.component == null ? [] : [kept.component(task.component)].flatMap((name) => name ?? []))
