import { readFile } from 'node:fs/promises'
import { englishOf, fail, notice, type Notice } from '../notice/notice.js'
import type { Db } from '../storage/database.js'
import { exportPlan, progressOf, runExport, type ExportPlan, type ExportRow, type ExportSource, type ExportState } from '../tracker/export.js'
import type { OpenedExportTarget } from '../tracker/export-target.js'
import { errorText } from '../tracker/link.js'
import type { TrackerPlace } from '../tracker/source.js'
import { ExportRecords, type ExportTargetFields } from './export-store.js'
import { whileExporting } from './exporting.js'
import { checkMove, switchTracker, type SwitchDeps, type Switched } from './switch.js'
import { isOpen } from '../tracker/model.js'
import { BuiltinFiles } from './files.js'
import { BuiltinNames } from './source.js'
import { BuiltinStore, type TaskKey } from './store.js'

/** A built-in project's tasks as the copy reads them; a task is named by its row id. */
export function builtinExportSource(store: BuiltinStore, names: BuiltinNames, project: string, files?: BuiltinFiles): ExportSource {
  let ids: Promise<Map<number, string>> | undefined
  const idsOf = () => (ids ??= store.rowIds(project))
  const keyOf = async (ref: string): Promise<TaskKey> => {
    for (const [number, id] of await idsOf()) if (id === ref) return { project, number }
    throw fail('builtin.noTask', { task: ref })
  }
  return {
    async tasks() {
      const map = await idsOf()
      const refOf = (key: TaskKey) => (key.project === project ? (map.get(key.number) ?? names.name(key)) : names.name(key))
      const list = await store.list([project])
      return Promise.all(
        list.map(async (task) => ({
          ref: map.get(task.number)!,
          number: task.number,
          id: names.name(task),
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          milestone: task.milestone?.name ?? null,
          labels: task.labels,
          estimate: task.estimate,
          parent: task.parent === null ? null : (map.get(task.parent) ?? null),
          blocks: task.blocks.map(refOf),
          related: task.related.map(refOf),
          files: (await store.files(task)).length,
        })),
      )
    },
    async comments(ref) {
      return (await store.comments(await keyOf(ref))).map((each) => ({ author: each.author, model: each.model, body: each.body, at: each.at }))
    },
    async files(ref) {
      if (files === undefined) return []
      const key = await keyOf(ref)
      return (await files.list(key, names.name(key))).map((file) => ({
        name: file.name,
        type: file.type,
        read: async () => (file.missing ? null : new Uint8Array(await readFile(file.path))),
      }))
    },
    async mark(ref, key, url) {
      const task = await keyOf(ref)
      const body = url === null ? `Moved to ${key}.` : `Moved to [${key}](${url}).`
      if ((await store.comments(task)).some((each) => each.author === 'service' && each.body === body)) return
      await store.comment(task, 'service', body)
    },
  }
}

export type { ExportState }

export interface BuiltinExportsDeps {
  db: Db
  /** The projects on the built-in tracker with their keys, read per call: the config is live. */
  places: () => Readonly<Record<string, TrackerPlace>>
  /** The folder of the attachments' bytes; without it no attachment is copied. */
  filesDir?: string
  connect: (project: string, target: ExportTargetFields) => Promise<OpenedExportTarget>
  /** Called when a run ends: the chain's view of the project. */
  refresh: (project: string) => Promise<unknown>
  /** A line of the service log. */
  say?: (line: string) => void
  /** The switch of the project to the copy's target (BTN-1074); without it the target's prefix goes unchecked and no switch is made. */
  switching?: SwitchDeps
}

/**
 * The copy of a built-in project's tasks into another tracker (BTN-1073): the plan, the start and the state. A copy runs
 * in the service, whatever the page does; while it runs, the project's tasks refuse changes (`builtin.exporting`).
 */
export class BuiltinExports {
  private readonly records: ExportRecords
  private readonly runs = new Map<string, Promise<void>>()
  private readonly failures = new Map<string, Notice>()
  private readonly say: (line: string) => void

  constructor(private readonly deps: BuiltinExportsDeps) {
    this.records = new ExportRecords(deps.db)
    this.say = deps.say ?? ((line) => console.log(line))
  }

  async plan(project: string, fields: ExportTargetFields): Promise<ExportPlan> {
    const source = this.sourceOf(project)
    this.checkTarget(project, fields)
    const target = await this.deps.connect(project, fields)
    try {
      return await exportPlan(source, target)
    } finally {
      await target.close().catch(() => {})
    }
  }

  /**
   * Starts the copy, or goes on with one that stopped; answers at once, the copy runs on. A finished copy to the same
   * target copies only the open tasks filed since; another target is refused once a task was copied.
   */
  async start(project: string, fields: ExportTargetFields): Promise<ExportState> {
    const source = this.sourceOf(project)
    if (this.runs.has(project)) return this.state(project)
    const prepared = this.prepare(project, source, fields)
    const run = prepared.then(
      (target) => (target === null ? undefined : this.run(project, source, target)),
      () => undefined,
    )
    this.runs.set(project, run)
    void run.finally(() => this.runs.delete(project))
    await prepared
    return this.state(project)
  }

  async state(project: string): Promise<ExportState> {
    const header = await this.records.header(project)
    const rows = await this.records.rows(project)
    return {
      target: header === null ? null : { profile: header.profile, place: header.place, key: header.key },
      running: this.runs.has(project),
      startedAt: header?.startedAt ?? null,
      finishedAt: header?.finishedAt ?? null,
      progress: progressOf(rows),
      total: await this.total(project, rows),
      failed: this.failures.get(project) ?? null,
    }
  }

  private async total(project: string, rows: readonly ExportRow[]): Promise<number> {
    const names = new BuiltinNames(this.deps.places())
    if (!names.knows(project)) return rows.length
    const store = new BuiltinStore(this.deps.db, (key) => names.name(key))
    const taken = new Set(rows.map((row) => row.number))
    return rows.length + (await store.list([project])).filter((task) => isOpen(task.status) && !taken.has(task.number)).length
  }

  /** The run of the project, if one goes on: tests wait for it. */
  settled(project: string): Promise<void> {
    return this.runs.get(project) ?? Promise.resolve()
  }

  /**
   * Moves the project to the tracker its finished copy went to (BTN-1074, `switch.ts`): the chain reads its tasks there
   * from now on, and the built-in ones stay in the database with their note.
   */
  async switch(project: string): Promise<Switched> {
    const switching = this.deps.switching
    if (switching === undefined) throw fail('builtin.off', {})
    const names = new BuiltinNames(this.deps.places())
    if (!names.knows(project)) throw fail('builtin.noProject', { project })
    if (this.runs.has(project)) throw fail('builtin.exporting', {})
    const store = new BuiltinStore(this.deps.db, (key) => names.name(key))
    const [header, rows, ids, list] = await Promise.all([this.records.header(project), this.records.rows(project), store.rowIds(project), store.list([project])])
    const tasks = list.map((task) => ({ ref: ids.get(task.number)!, id: names.name(task), open: isOpen(task.status) }))
    const switched = switchTracker(switching, { project, header, rows, tasks })
    this.say(`export: ${project}: the project now reads its tasks from ${switched.move.tracker}, ${switched.names.size} of them under new ids`)
    await this.deps.refresh(project).catch(() => {})
    return switched
  }

  private checkTarget(project: string, fields: ExportTargetFields): void {
    if (this.deps.switching !== undefined) checkMove(this.deps.switching, project, fields)
  }

  private sourceOf(project: string): ExportSource {
    const names = new BuiltinNames(this.deps.places())
    if (!names.knows(project)) throw fail('builtin.noProject', { project })
    const store = new BuiltinStore(this.deps.db, (key) => names.name(key))
    const files = this.deps.filesDir === undefined ? undefined : new BuiltinFiles(store, this.deps.filesDir, this.say)
    return builtinExportSource(store, names, project, files)
  }

  /** The target to copy into; `null` — the copy to it is finished and every open task is there. */
  private async prepare(project: string, source: ExportSource, fields: ExportTargetFields): Promise<OpenedExportTarget | null> {
    const header = await this.records.header(project)
    const same = header !== null && header.profile === fields.profile && header.place === fields.place && header.key === fields.key
    // A task filed after a finished copy goes over by its repeat (BTN-1074): the switch waits for every open one.
    if (same && header.finishedAt !== null) {
      const marked = new Set((await this.records.rows(project)).flatMap((row) => (row.stage === 'marked' ? [row.ref] : [])))
      if ((await source.tasks()).every((task) => !isOpen(task.status) || marked.has(task.ref))) return null
      await this.records.reopen(project)
    }
    // A row may stand for a task created there already: the copy goes on only with that target.
    if (header !== null && !same && (await this.records.rows(project)).length > 0) throw fail('export.otherTarget', {})
    this.checkTarget(project, fields)
    const target = await this.deps.connect(project, fields)
    if (!same) await this.records.begin(project, fields)
    this.failures.delete(project)
    return target
  }

  private async run(project: string, source: ExportSource, target: OpenedExportTarget): Promise<void> {
    try {
      await whileExporting(project, () => runExport({ source, target, log: this.records.log(project), say: this.say }))
      await this.records.finish(project)
      this.say(`export: ${project}: the tasks are copied to ${target.title}`)
    } catch (error) {
      const failed = notice('export.failed', { tracker: target.title }, { detail: errorText(error) })
      this.failures.set(project, failed)
      this.say(`export: ${project}: ${englishOf(failed)}`)
    } finally {
      await target.close().catch(() => {})
      await this.deps.refresh(project).catch(() => {})
    }
  }
}
