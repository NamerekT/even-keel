import { readFile } from 'node:fs/promises'
import { englishOf, fail, notice, type Notice } from '../notice/notice.js'
import type { EventDraft, EventLevel, EventPlace } from '../event-log/model.js'
import type { Db } from '../storage/database.js'
import { exportPlan, progressOf, runExport, takes, type ExportComment, type ExportLog, type ExportPlan, type ExportRow, type ExportRun, type ExportSource, type ExportState } from '../tracker/export.js'
import { pacedEditor, realClock, WritePace } from '../tracker/pace.js'
import { rateLimitOf } from '../tracker/rate-limit.js'
import type { TaskChange } from '../tracker/history.js'
import type { OpenedExportTarget } from '../tracker/export-target.js'
import { errorText } from '../tracker/link.js'
import { atStage, stackOf, stopExtras } from '../tracker/transfer-stop.js'
import type { TrackerPlace } from '../tracker/source.js'
import { checkExport, checkMatched, repairExport, type TransferReport, type TransferSummary } from '../tracker/transfer-check.js'
import { ExportRecords, type ExportHeader, type ExportTargetFields } from './export-store.js'
import { TransferReports } from './transfer-store.js'
import { whileExporting } from './exporting.js'
import { checkMove, switchTracker, type SwitchDeps, type Switched } from './switch.js'
import { isOpen } from '../tracker/model.js'
import { BuiltinFiles } from './files.js'
import { BuiltinNames } from './source.js'
import { BuiltinStore, type TaskKey } from './store.js'
import { historySummary } from '../tracker/history-export.js'

/** What the copy takes besides a task's fields and journal: the history as one summary, the closed tasks (BTN-1289). */
export interface BuiltinExportOptions {
  files?: BuiltinFiles
  history?: boolean
  closed?: boolean
}

/**
 * A built-in project's tasks as the copy reads them; a task is named by its row id. With `closed`, a closed task's
 * journal starts with its dates here: the target creates and closes the copy today.
 */
export function builtinExportSource(store: BuiltinStore, names: BuiltinNames, project: string, { files, history = false, closed = false }: BuiltinExportOptions = {}): ExportSource {
  let ids: Promise<Map<number, string>> | undefined
  const idsOf = () => (ids ??= store.rowIds(project))
  const keyOf = async (ref: string): Promise<TaskKey> => {
    for (const [number, id] of await idsOf()) if (id === ref) return { project, number }
    throw fail('builtin.noTask', { task: ref })
  }
  /** The journal without the copy's own "Moved to" notes: they stay behind, neither copied nor counted by the check. */
  const journalOf = async (task: TaskKey) => (await store.comments(task)).filter((each) => !(each.author === 'service' && each.body.startsWith('Moved to ')))
  return {
    closed,
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
          component: task.component,
          labels: task.labels,
          estimate: task.estimate,
          parent: task.parent === null ? null : (map.get(task.parent) ?? null),
          blocks: task.blocks.map(refOf),
          related: task.related.map(refOf),
          files: (await store.files(task)).length,
          comments: (await journalOf(task)).length + (history && (await store.history(task)).length > 0 ? 1 : 0) + (closed && !isOpen(task.status) ? 1 : 0),
          history: (await store.history(task)).length,
        })),
      )
    },
    async comments(ref) {
      const task = await keyOf(ref)
      const comments: ExportComment[] = (await journalOf(task)).map((each) => ({ author: each.author, model: each.model, body: each.body, at: each.at }))
      const all = history || closed ? await store.history(task) : []
      const changes = history ? all : []
      if (changes.length > 0) comments.push({ author: 'service', model: null, body: historySummary(changes), at: new Date(Math.max(...changes.map((each) => each.at))).toISOString() })
      const card = closed ? await store.get(task) : null
      if (card != null && !isOpen(card.status)) comments.unshift(datesEntry(card.createdAt, closedAt(all) ?? card.updatedAt))
      return comments
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

/** The time of the task's last change of status; `null` — its history does not go back that far. */
function closedAt(changes: readonly TaskChange[]): string | null {
  const last = changes.findLast((each) => each.field === 'status')
  return last === undefined ? null : new Date(last.at).toISOString()
}

/** The first entry of a closed task's copied journal: when it was created and closed here, in UTC as `journalEntry`. */
function datesEntry(created: string, closed: string): ExportComment {
  const utc = (at: string) => new Date(at).toISOString().slice(0, 16).replace('T', ' ')
  return { author: 'service', model: null, body: `Created ${utc(created)} UTC, closed ${utc(closed)} UTC in the built-in tracker.`, at: closed }
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
  /** An entry of the event log: a copy started, went on, stopped or ended, the project switched (BTN-1193). */
  event?: (draft: EventDraft) => void
  /** A tracker's name by its adapter's kind, for the switch's entry; without it the kind itself. */
  trackerTitle?: (kind: string) => string
  now?: () => Date
  /** The wait for a tracker's rate limit and the pace of its writes; tests give their own. */
  sleep?: (ms: number) => Promise<void>
}

/** The first wait for a limit refusal that names no time, doubled at each next one in a row up to the last. */
const FIRST_PAUSE_MS = 60_000
const LAST_PAUSE_MS = 30 * 60_000
/** Past the tracker's own time: its clock and ours may differ by a little. */
const AFTER_RESET_MS = 1_000

/**
 * The copy of a built-in project's tasks into another tracker (BTN-1073): the plan, the start and the state. A copy runs
 * in the service, whatever the page does; while it runs, the project's tasks refuse changes (`builtin.exporting`).
 */
export class BuiltinExports {
  private readonly records: ExportRecords
  private readonly runs = new Map<string, Promise<void>>()
  /** Until when each project's run waits out its tracker's rate limit (ISO). */
  private readonly waiting = new Map<string, string>()
  private readonly checkFailures = new Map<string, Notice>()
  private readonly reports: TransferReports
  private readonly say: (line: string) => void
  private readonly now: () => Date
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly deps: BuiltinExportsDeps) {
    this.now = deps.now ?? (() => new Date())
    this.sleep = deps.sleep ?? realClock.sleep
    this.records = new ExportRecords(deps.db, this.now)
    this.reports = new TransferReports(deps.db)
    this.say = deps.say ?? ((line) => console.log(line))
  }

  async plan(project: string, fields: ExportTargetFields): Promise<ExportPlan> {
    const source = this.sourceOf(project, fields)
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
    const header = await this.records.header(project)
    const same = header !== null && header.profile === fields.profile && header.place === fields.place && header.key === fields.key
    const source = this.sourceOf(project, same ? header : fields)
    if (this.runs.has(project)) return this.state(project)
    return this.launch(project, source, this.prepare(project, source, fields), runExport)
  }

  /**
   * "Repeat" after a check that did not match or could not count (BTN-1291): the copy goes on to its target, each task
   * gets what its copy lacks (`repairExport`), and the check counts again.
   */
  async retry(project: string): Promise<ExportState> {
    const header = await this.records.header(project)
    if (header === null) throw fail('switch.noCopy', { key: this.deps.switching?.config().keys[project] ?? project })
    const source = this.sourceOf(project, header)
    if (this.runs.has(project)) return this.state(project)
    const prepared = (async () => {
      this.checkTarget(project, header)
      const target = await this.deps.connect(project, header)
      if (header.finishedAt !== null) await this.records.reopen(project)
      await this.records.saveFailed(project, null)
      const total = await this.total(project, await this.records.rows(project), header.closed)
      this.event('info', notice('eventLog.exportContinued', { project, tracker: target.title, total }), { view: 'tracker', project })
      return target
    })()
    return this.launch(project, source, prepared, repairExport)
  }

  private async launch(project: string, source: ExportSource, prepared: Promise<OpenedExportTarget | null>, work: (run: ExportRun) => Promise<void>): Promise<ExportState> {
    const run = prepared.then(
      (target) => (target === null ? undefined : this.run(project, source, target, work)),
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
      target:
        header === null
          ? null
          : { profile: header.profile, place: header.place, key: header.key, ...(header.history === true ? { history: true } : {}), ...(header.closed === true ? { closed: true } : {}) },
      running: this.runs.has(project),
      startedAt: header?.startedAt ?? null,
      finishedAt: header?.finishedAt ?? null,
      progress: progressOf(rows),
      total: await this.total(project, rows, header?.closed),
      failed: header?.failed ?? null,
      waiting: this.waiting.get(project) ?? null,
      check: header?.checked ?? null,
      checkFailed: this.checkFailures.get(project) ?? null,
    }
  }

  /** The project's finished transfers, the latest first (BTN-1291). */
  transfers(project: string): Promise<TransferSummary[]> {
    return this.reports.list(project)
  }

  /** `null` — no such report. */
  transfer(id: string): Promise<TransferReport | null> {
    return this.reports.read(id)
  }

  private async total(project: string, rows: readonly ExportRow[], closed = false): Promise<number> {
    const names = new BuiltinNames(this.deps.places())
    if (!names.knows(project)) return rows.length
    const store = new BuiltinStore(this.deps.db, (key) => names.name(key))
    const taken = new Set(rows.map((row) => row.number))
    return rows.length + (await store.list([project])).filter((task) => takes({ closed }, task) && !taken.has(task.number)).length
  }

  /** The run of the project, if one goes on: tests wait for it. */
  settled(project: string): Promise<void> {
    return this.runs.get(project) ?? Promise.resolve()
  }

  /**
   * Moves the project to the tracker its finished copy went to (BTN-1074, `switch.ts`): the chain reads its tasks there
   * from now on, and the built-in ones stay in the database with their note.
   */
  async switch(project: string, anyway = false): Promise<Switched> {
    const switching = this.deps.switching
    if (switching === undefined) throw fail('builtin.off', {})
    const names = new BuiltinNames(this.deps.places())
    if (!names.knows(project)) throw fail('builtin.noProject', { project })
    if (this.runs.has(project)) throw fail('builtin.exporting', {})
    const store = new BuiltinStore(this.deps.db, (key) => names.name(key))
    const [header, rows, ids, list] = await Promise.all([this.records.header(project), this.records.rows(project), store.rowIds(project), store.list([project])])
    const tasks = list.map((task) => ({ ref: ids.get(task.number)!, id: names.name(task), open: isOpen(task.status) }))
    const from = switching.config().keys[project] ?? project
    const switched = switchTracker(switching, { project, header, rows, tasks, anyway })
    this.say(`export: ${project}: the project now reads its tasks from ${switched.move.tracker}, ${switched.names.size} of them under new ids`)
    const tracker = this.deps.trackerTitle?.(switched.move.tracker) ?? switched.move.tracker
    const said = { project, tracker, from, to: switched.move.key }
    const report = await this.report(project, header!, switched.move.tracker, from)
    const matched = report?.matched ?? true
    const place: EventPlace = { view: 'tracker', project, ...(report === null ? {} : { transfer: report.id }) }
    this.event(matched ? 'info' : 'warning', notice(matched ? 'eventLog.transferMatched' : 'eventLog.transferMismatched', said), place)
    await this.deps.refresh(project).catch(() => {})
    return switched
  }

  /** The switched transfer's report; `null` — it could not be written, and the switch stands. */
  private async report(project: string, header: ExportHeader, tracker: string, from: string): Promise<TransferReport | null> {
    try {
      const check = header.checked!
      return await this.reports.add({
        project,
        direction: 'export',
        tracker,
        place: header.place,
        key: header.key,
        sourceKey: header.sourceKey ?? from,
        closed: header.closed === true,
        history: header.history === true,
        startedAt: header.startedAt,
        finishedAt: header.finishedAt,
        switchedAt: this.now().toISOString(),
        plan: header.plan!,
        check,
        matched: checkMatched(check),
      })
    } catch (error) {
      this.say(`export: ${project}: the transfer's report is not saved: ${errorText(error)}`)
      return null
    }
  }

  private event(level: EventLevel, said: Notice, place: EventPlace): void {
    this.deps.event?.({ level, notice: said, place })
  }

  private checkTarget(project: string, fields: ExportTargetFields): void {
    if (this.deps.switching !== undefined) checkMove(this.deps.switching, project, fields)
  }

  /** The source with the choices of `fields`: a started copy's, from its header. */
  private sourceOf(project: string, { history = false, closed = false }: Pick<ExportTargetFields, 'history' | 'closed'>): ExportSource {
    const names = new BuiltinNames(this.deps.places())
    if (!names.knows(project)) throw fail('builtin.noProject', { project })
    const store = new BuiltinStore(this.deps.db, (key) => names.name(key))
    const files = this.deps.filesDir === undefined ? undefined : new BuiltinFiles(store, this.deps.filesDir, this.say)
    return builtinExportSource(store, names, project, { files, history, closed })
  }

  /** The target to copy into; `null` — the copy to it is finished and every task it takes is there. */
  private async prepare(project: string, source: ExportSource, fields: ExportTargetFields): Promise<OpenedExportTarget | null> {
    const header = await this.records.header(project)
    const same = header !== null && header.profile === fields.profile && header.place === fields.place && header.key === fields.key
    // A task filed after a finished copy goes over by its repeat (BTN-1074): the switch waits for every open one, or
    // every one with the closed ones.
    if (same && header.finishedAt !== null) {
      const marked = new Set((await this.records.rows(project)).flatMap((row) => (row.stage === 'marked' ? [row.ref] : [])))
      if ((await source.tasks()).every((task) => !takes(source, task) || marked.has(task.ref))) return null
      await this.records.reopen(project)
    }
    // A row may stand for a task created there already: the copy goes on only with that target.
    if (header !== null && !same && (await this.records.rows(project)).length > 0) throw fail('export.otherTarget', {})
    this.checkTarget(project, fields)
    const target = await this.deps.connect(project, fields)
    if (!same) {
      await this.records.begin(project, fields)
      // The plan as the person saw it, kept for the report (BTN-1291).
      await this.records.savePlan(project, await exportPlan(source, target))
    }
    await this.records.saveFailed(project, null)
    const total = await this.total(project, await this.records.rows(project), source.closed)
    const said = same
      ? notice('eventLog.exportContinued', { project, tracker: target.title, total })
      : notice('eventLog.exportStarted', { project, tracker: target.title, place: fields.place, newKey: fields.key, total })
    this.event('info', said, { view: 'tracker', project })
    return target
  }

  private async run(project: string, source: ExportSource, target: OpenedExportTarget, work: (run: ExportRun) => Promise<void>): Promise<void> {
    const place: EventPlace = { view: 'tracker', project }
    const { writes } = target.editor
    const clock = { now: () => this.now().getTime(), sleep: this.sleep }
    const paced = writes === undefined ? target : { ...target, editor: pacedEditor(target.editor, new WritePace(writes, clock)) }
    try {
      await whileExporting(project, async () => {
        await this.throughLimits(project, target.title, (log) => work({ source, target: paced, log, say: this.say }))
        await this.records.finish(project)
        this.say(`export: ${project}: the tasks are copied to ${target.title}`)
        const copied = progressOf(await this.records.rows(project)).marked
        this.event('info', notice('eventLog.exportFinished', { project, tracker: target.title, copied }), place)
        await this.check(project, source, target)
      })
    } catch (error) {
      const stop = stopExtras(error)
      const failed = notice('export.failed', { tracker: target.title }, stop)
      await this.records.saveFailed(project, failed).catch(() => {})
      this.sayStop(project, failed, error)
      this.event('warning', notice('eventLog.exportFailed', { project, tracker: target.title }, stop), place)
    } finally {
      await target.close().catch(() => {})
      await this.deps.refresh(project).catch(() => {})
    }
  }

  /**
   * Runs `work` again after each refusal of the tracker's rate limit (BTN-1190): its stages are saved, so it goes on from
   * where the refusal stopped it. The wait is the tracker's time, else a pause doubled at each refusal in a row that
   * moved nothing on; the run counts as going on meanwhile, the project's edits still refused.
   */
  private async throughLimits(project: string, tracker: string, work: (log: ExportLog) => Promise<void>): Promise<void> {
    const records = this.records.log(project)
    let saves = 0
    const log: ExportLog = {
      rows: () => records.rows(),
      save: async (row) => {
        saves += 1
        await records.save(row)
      },
    }
    for (let pauses = 0; ; ) {
      const before = saves
      try {
        return await work(log)
      } catch (error) {
        const limit = rateLimitOf(error)
        if (limit === null) throw error
        if (saves > before) pauses = 0
        const now = this.now().getTime()
        const ms = limit.until === null ? Math.min(FIRST_PAUSE_MS * 2 ** pauses++, LAST_PAUSE_MS) : Math.max(limit.until.getTime() - now, 0) + AFTER_RESET_MS
        const until = new Date(now + ms).toISOString()
        this.waiting.set(project, until)
        this.say(`export: ${project}: ${tracker} limits the writes, the copy waits until ${until}: ${errorText(error)}`)
        try {
          await this.sleep(ms)
        } finally {
          this.waiting.delete(project)
        }
      }
    }
  }

  /**
   * Goes on with each copy a restart of the service broke off (BTN-1190): not finished and not stopped by a failure,
   * which waits for "Continue" as before.
   */
  async resume(): Promise<void> {
    const names = new BuiltinNames(this.deps.places())
    for (const project of await this.records.unfinished()) {
      const header = names.knows(project) ? await this.records.header(project) : null
      if (header === null || this.runs.has(project)) continue
      this.say(`export: ${project}: the copy goes on after the restart`)
      await this.start(project, header).catch((error: unknown) => this.say(`export: ${project}: the copy does not go on after the restart: ${errorText(error)}`))
    }
  }

  /** Counts both sides after a run (BTN-1291); a count that fails leaves the copy finished, with no check to switch by. */
  private async check(project: string, source: ExportSource, target: OpenedExportTarget): Promise<void> {
    this.checkFailures.delete(project)
    try {
      if ((await this.records.header(project))?.plan === null) await this.records.savePlan(project, await exportPlan(source, target))
      const rows = await this.records.rows(project)
      const check = await atStage({ stage: 'check', task: null }, () => checkExport(source, target, rows, this.now))
      await this.records.saveCheck(project, check)
      this.say(`export: ${project}: the check of the copy ${checkMatched(check) ? 'matched' : 'did not match'}`)
    } catch (error) {
      await this.records.saveCheck(project, null).catch(() => {})
      const failed = notice('export.checkFailed', { tracker: target.title }, stopExtras(error))
      this.checkFailures.set(project, failed)
      this.sayStop(project, failed, error)
    }
  }

  /** The stop in the service log: its message, then the stack of the error under it (BTN-1455). */
  private sayStop(project: string, failed: Notice, error: unknown): void {
    this.say(`export: ${project}: ${englishOf(failed)}`)
    const stack = stackOf(error)
    if (stack !== undefined) this.say(`export: ${project}: ${stack}`)
  }
}
