import type { ChainState } from '../chain/model.js'
import type { TrackerMove } from '../config-form.js'
import type { EventDraft, EventLevel, EventPlace } from '../event-log/model.js'
import { englishOf, fail, notice, NoticeError, type Notice } from '../notice/notice.js'
import type { Db } from '../storage/database.js'
import { distinctFiles, type ImportSource, type ImportTask } from '../tracker/import.js'
import type { OpenedImportSource } from '../tracker/import-source.js'
import { importPlan, type ImportAuthorChoice, type ImportPlan, type ImportPlanning, type ImportState, type ImportSwitching } from '../tracker/import-plan.js'
import { retryingSource } from '../tracker/import-retry.js'
import { errorText } from '../tracker/link.js'
import { checkImport, checkMatched, sourceCounts, type ImportedTask, type TransferCheck } from '../tracker/transfer-check.js'
import { atStage, stackOf, stopExtras } from '../tracker/transfer-stop.js'
import { PlanReads } from './import-reading.js'
import { ImportRecords, type ImportHeader } from './import-store.js'
import { goneKeys, IMPORT_STAGES, runImport, unchanged, type ImportRow } from './import-run.js'
import { listMilestones } from './milestones.js'
import { BUILTIN } from './model.js'
import { BuiltinStore } from './store.js'
import { switchHolds } from './switch.js'
import { TransferReports } from './transfer-store.js'

export type { OpenedImportSource }

export interface ImportSwitchDeps {
  chain(): Readonly<ChainState>
  /** Moves the dispatcher's state and the tasks' runs to the new ids; called only when some id changes. */
  rename(project: string, names: ReadonlyMap<string, string>): void
  /** Writes the project's tracker as the built-in one and drops its profile. */
  move(project: string, move: TrackerMove): void
}

export interface BuiltinImportsDeps {
  db: Db
  /** Opens the project's tracker for the import; refuses one without an import (`import.none`). */
  open: (project: string) => Promise<OpenedImportSource>
  /** The folder of the attachments' bytes; without it no attachment moves. */
  filesDir?: string
  /** Called when a run ends and after the switch: the chain's view of the project. */
  refresh: (project: string) => Promise<unknown>
  switching: ImportSwitchDeps
  event?: (draft: EventDraft) => void
  say?: (line: string) => void
  now?: () => Date
  /** How long the plan's read of the source is kept (`PLAN_KEEP_MS` where absent). */
  planKeepMs?: number
  /** The pauses before each new ask of a transient refusal of the source (`RETRY_PAUSES_MS` where absent). */
  retryPausesMs?: readonly number[]
}

/**
 * The import of a project's whole history into the built-in tracker (BTN-1405): the plan, the start, the state and the
 * switch. An import runs in the service whatever the page does; the project stays on its tracker until the switch, and
 * the source's tasks are not marked.
 */
export class BuiltinImports {
  private readonly records: ImportRecords
  private readonly reports: TransferReports
  private readonly runs = new Map<string, Promise<void>>()
  private readonly failures = new Map<string, Notice>()
  private readonly checkFailures = new Map<string, Notice>()
  /** How far each check after a run is: the window's meter. */
  private readonly checks = new Map<string, ImportPlanning>()
  /** The step of each switch going on: the window's meter. */
  private readonly switches = new Map<string, ImportSwitching>()
  private readonly plans: PlanReads
  private readonly say: (line: string) => void
  private readonly now: () => Date
  /** The project's tracker with each transient refusal asked again (BTN-1460): every read of the import goes through it. */
  private readonly open: (project: string) => Promise<OpenedImportSource>

  constructor(private readonly deps: BuiltinImportsDeps) {
    this.now = deps.now ?? (() => new Date())
    this.records = new ImportRecords(deps.db, this.now)
    this.reports = new TransferReports(deps.db)
    this.say = deps.say ?? ((line) => console.log(line))
    const retry = { say: this.say, ...(deps.retryPausesMs === undefined ? {} : { pauses: deps.retryPausesMs }) }
    this.open = async (project) => {
      const opened = await deps.open(project)
      return { ...opened, source: retryingSource(opened.source, retry) }
    }
    this.plans = new PlanReads({ open: this.open, say: this.say, now: () => this.now().getTime(), ...(deps.planKeepMs === undefined ? {} : { keepMs: deps.planKeepMs }) })
  }

  /**
   * What the import would write, with the authors as `authors` picks them. Nothing is written. The source is read once
   * for the window: a pick counts again from the same read (`PlanReads`).
   */
  async plan(project: string, authors: readonly ImportAuthorChoice[] = []): Promise<ImportPlan> {
    await this.checkEmpty(project)
    const read = await this.plans.get(project)
    return importPlan(read.source, read.counted, authors, read.milestones)
  }

  /** Starts the import, or goes on with one that stopped; answers at once, the import runs on. */
  async start(project: string, authors: readonly ImportAuthorChoice[] = []): Promise<ImportState> {
    if (this.runs.has(project)) return this.state(project)
    if (this.switches.has(project)) throw fail('import.running', {})
    await this.checkEmpty(project)
    const prepared = (async () => {
      const opened = await this.open(project)
      try {
        const header = await this.records.header(project)
        const same = header !== null && header.tracker === opened.tracker && header.place === opened.place && header.key === opened.key
        if (header !== null && !same && (await this.records.rows(project)).length > 0) throw fail('import.otherTracker', { tracker: opened.title })
        if (same) {
          if (header.finishedAt !== null) await this.records.reopen(project)
        } else {
          const read = await this.plans.take(project, opened)
          const plan = importPlan(read.source, read.counted, authors, read.milestones)
          await this.records.begin(project, opened, authors, plan)
        }
        this.failures.delete(project)
        const total = (await this.records.header(project))!.plan?.counts.tasks ?? 0
        this.event('info', notice(same ? 'eventLog.importContinued' : 'eventLog.importStarted', { project, tracker: opened.title, total }), { view: 'tracker', project })
        return opened
      } catch (error) {
        await opened.close().catch(() => {})
        throw error
      }
    })()
    const run = prepared.then(
      (opened) => this.run(project, opened),
      () => undefined,
    )
    this.runs.set(project, run)
    void run.finally(() => this.runs.delete(project))
    await prepared
    return this.state(project)
  }

  async state(project: string): Promise<ImportState> {
    const header = await this.records.header(project)
    const rows = await this.records.rows(project)
    return {
      from: header === null ? null : { tracker: header.tracker, place: header.place, key: header.key },
      authors: header?.authors ?? [],
      running: this.runs.has(project),
      startedAt: header?.startedAt ?? null,
      finishedAt: header?.finishedAt ?? null,
      progress: importProgress(rows),
      total: Math.max(header?.plan?.counts.tasks ?? 0, rows.length),
      failed: this.failures.get(project) ?? null,
      check: header?.checked ?? null,
      checkFailed: this.checkFailures.get(project) ?? null,
      checking: this.checks.get(project) ?? null,
      switching: this.switches.get(project) ?? null,
      planning: this.plans.planning(project),
    }
  }

  /** The run of the project, if one goes on: tests wait for it. */
  settled(project: string): Promise<void> {
    return this.runs.get(project) ?? Promise.resolve()
  }

  /**
   * Moves the project onto the built-in tracker after its import (BTN-1405): a last pass takes what changed in the
   * source since, the check counts again and is frozen into the report, and the project's tracker becomes the built-in
   * one under the same key. `anyway` — past a check that did not match.
   */
  async switch(project: string, anyway = false): Promise<{ key: string; renamed: number }> {
    if (this.runs.has(project) || this.switches.has(project)) throw fail('import.running', {})
    const header = await this.records.header(project)
    if (header === null || header.finishedAt === null) throw fail('import.notFinished', {})
    if (header.checked === null) throw fail('switch.noCheck', {})
    if (!checkMatched(header.checked) && !anyway) throw fail('switch.mismatch', {})
    // The ids the switch changes are known only after the source's read: its released tasks are asked again then.
    this.checkHolds(project, header, () => true)
    const step = (stage: ImportSwitching['stage']) => (done: number, total: number) => this.switches.set(project, { stage, done, total })
    step('pass')(0, 0)
    try {
      return await this.switchOver(project, header, anyway, step)
    } finally {
      this.switches.delete(project)
    }
  }

  private async switchOver(
    project: string,
    header: ImportHeader,
    anyway: boolean,
    step: (stage: ImportSwitching['stage']) => (done: number, total: number) => void,
  ): Promise<{ key: string; renamed: number }> {
    this.say(`import: ${project}: the switch begins with a last pass over what changed in the source`)
    const { check, names, title } = await this.opened(project, async (opened) => {
      try {
        return await this.lastPass(project, header, opened, step)
      } catch (error) {
        if (error instanceof NoticeError) throw error
        const failed = notice('import.passFailed', { tracker: opened.title }, this.stopOf(error, opened))
        this.sayStop(project, failed, error)
        throw new NoticeError(failed, { cause: error })
      }
    })
    if (!checkMatched(check) && !anyway) throw fail('switch.mismatch', {})
    // Asked again at the move: the chain may have started during the pass.
    this.checkHolds(project, header, (task) => !names.has(task))
    step('switch')(0, 0)
    if (names.size > 0) this.deps.switching.rename(project, names)
    this.deps.switching.move(project, { tracker: BUILTIN, trackerProject: null, key: header.key })
    this.say(`import: ${project}: the project now reads its tasks from the built-in tracker`)
    const report = await this.report(project, header, check)
    await this.records.forget(project)
    const place: EventPlace = { view: 'tracker', project, ...(report === null ? {} : { transfer: report }) }
    const matched = checkMatched(check)
    this.event(matched ? 'info' : 'warning', notice(matched ? 'eventLog.importMatched' : 'eventLog.importMismatched', { project, tracker: title }), place)
    await this.deps.refresh(project).catch(() => {})
    return { key: header.key, renamed: names.size }
  }

  /** The switch's last pass over what changed in the source and its check. */
  private async lastPass(
    project: string,
    header: ImportHeader,
    opened: OpenedImportSource,
    step: (stage: ImportSwitching['stage']) => (done: number, total: number) => void,
  ): Promise<{ check: TransferCheck; names: Map<string, string>; title: string }> {
    const tasks = await atStage({ stage: 'read', task: null }, () => opened.source.tasks())
    const taken = await runImport({ ...this.runOf(project, header, opened.source), progress: step('pass') }, true)
    this.say(`import: ${project}: the last pass took ${taken} of ${tasks.length} tasks, new or changed in ${opened.title}`)
    step('check')(0, tasks.length)
    this.say(`import: ${project}: the check of the switch begins`)
    const check = await this.count(project, opened.source, true, step('check'))
    await this.records.saveCheck(project, check)
    this.say(`import: ${project}: the check of the switch ${checkMatched(check) ? 'matched' : 'did not match'}`)
    const names = new Map(tasks.flatMap((task) => (task.id === `${header.key}-${task.number}` ? [] : [[task.id, `${header.key}-${task.number}`] as const])))
    return { check, names, title: opened.title }
  }

  /** Refuses the switch while the chain works on the project; released tasks and pull requests whose ids it `kept` do not hold it. */
  private checkHolds(project: string, header: ImportHeader, kept: (task: string) => boolean): void {
    const holds = switchHolds(this.deps.switching.chain(), project, kept)
    if (holds.length > 0) throw fail('switch.held', { key: header.key }, { items: holds })
  }

  /** The switched import's report; `null` — it could not be written, and the switch stands. */
  private async report(project: string, header: ImportHeader, check: TransferCheck): Promise<string | null> {
    try {
      const report = await this.reports.add({
        project,
        direction: 'import',
        tracker: header.tracker,
        place: header.place,
        key: header.key,
        sourceKey: header.key,
        closed: true,
        history: header.plan?.losses.every((loss) => loss.kind !== 'history') ?? false,
        startedAt: header.startedAt,
        finishedAt: header.finishedAt,
        switchedAt: this.now().toISOString(),
        plan: header.plan!,
        check,
        matched: checkMatched(check),
      })
      return report.id
    } catch (error) {
      this.say(`import: ${project}: the transfer's report is not saved: ${errorText(error)}`)
      return null
    }
  }

  /** Refuses a project the built-in tracker has tasks of that no import of it wrote: it was on the built-in tracker. */
  private async checkEmpty(project: string): Promise<void> {
    if ((await this.records.header(project)) !== null) return
    const { rows } = await this.deps.db.query<{ count: number }>('select count(*)::int as count from builtin_tasks where project_id = $1', [project])
    if ((rows[0]?.count ?? 0) > 0) throw fail('import.hadBuiltin', {})
  }

  private async opened<T>(project: string, body: (opened: OpenedImportSource) => Promise<T>): Promise<T> {
    const opened = await this.open(project)
    try {
      return await body(opened)
    } finally {
      await opened.close().catch(() => {})
    }
  }

  private runOf(project: string, header: ImportHeader, source: ImportSource) {
    return {
      source,
      db: this.deps.db,
      project,
      key: header.key,
      ...(this.deps.filesDir === undefined ? {} : { filesDir: this.deps.filesDir }),
      authors: header.authors,
      log: this.records.log(project),
      say: this.say,
    }
  }

  private async run(project: string, opened: OpenedImportSource): Promise<void> {
    const place: EventPlace = { view: 'tracker', project }
    try {
      const header = (await this.records.header(project))!
      await runImport(this.runOf(project, header, opened.source))
      await this.records.finish(project)
      const imported = importProgress(await this.records.rows(project)).done
      this.say(`import: ${project}: ${imported} tasks are imported from ${opened.title}`)
      this.event('info', notice('eventLog.importFinished', { project, tracker: opened.title, imported }), place)
      await this.check(project, opened)
    } catch (error) {
      const stop = this.stopOf(error, opened)
      const failed = notice('import.failed', { tracker: opened.title }, stop)
      this.failures.set(project, failed)
      this.sayStop(project, failed, error)
      this.event('warning', notice('eventLog.importFailed', { project, tracker: opened.title }, stop), place)
    } finally {
      await opened.close().catch(() => {})
      await this.deps.refresh(project).catch(() => {})
    }
  }

  private async check(project: string, opened: OpenedImportSource): Promise<void> {
    this.checkFailures.delete(project)
    this.checks.set(project, { done: 0, total: 0 })
    this.say(`import: ${project}: the check of the import begins`)
    try {
      const check = await this.count(project, opened.source, false, (done, total) => this.checks.set(project, { done, total }))
      await this.records.saveCheck(project, check)
      this.say(`import: ${project}: the check of the import ${checkMatched(check) ? 'matched' : 'did not match'}`)
    } catch (error) {
      await this.records.saveCheck(project, null).catch(() => {})
      const failed = notice('import.checkFailed', { tracker: opened.title }, this.stopOf(error, opened))
      this.checkFailures.set(project, failed)
      this.sayStop(project, failed, error)
    } finally {
      this.checks.delete(project)
    }
  }

  /** Where the import stopped and why (BTN-1455), the task with its link in the source where the tracker has one. */
  private stopOf(error: unknown, opened: OpenedImportSource) {
    return stopExtras(error, opened.url)
  }

  /** The stop in the service log: its message, then the stack of the error under it. */
  private sayStop(project: string, failed: Notice, error: unknown): void {
    this.say(`import: ${project}: ${englishOf(failed)}`)
    const stack = stackOf(error)
    if (stack !== undefined) this.say(`import: ${project}: ${stack}`)
  }

  /**
   * The check of both sides: the source's tasks against the built-in ones of their numbers. Each task's counts in the
   * source are kept in its row (`seen`); with `known` — the switch's check — a task unchanged since the last check is
   * counted from them, not read again (BTN-1432). The built-in side is read whole either way.
   */
  private async count(project: string, source: ImportSource, known = false, progress?: (done: number, total: number) => void): Promise<TransferCheck> {
    const store = new BuiltinStore(this.deps.db)
    const tasks = await atStage({ stage: 'check', task: null }, () => source.tasks())
    const log = this.records.log(project)
    const rows = new Map((await log.rows()).map((row) => [row.ref, row]))
    const seen = new Map<string, ImportRow>()
    const refOf = new Map(tasks.map((task) => [task.number, task.ref]))
    const refs = (numbers: readonly { project: string; number: number }[]) => numbers.flatMap((each) => (each.project === project && refOf.has(each.number) ? [refOf.get(each.number)!] : []))
    const counts = async (task: ImportTask) => {
      const row = rows.get(task.ref)
      if (known && unchanged(task, row) && row!.seen!.filesByKey === true) return row!.seen!
      const counted = await atStage({ stage: 'check', task: task.id }, () => sourceCounts(source, task))
      if (row !== undefined && task.modifiedAt !== null) seen.set(task.ref, { ...row, seen: { at: task.modifiedAt, ...counted, filesByKey: true } })
      return counted
    }
    const imported = async (task: ImportTask): Promise<ImportedTask | null> => {
      const key = { project, number: task.number }
      const got = await store.get(key)
      if (got === undefined) return null
      const passed = new Set(rows.has(task.ref) ? goneKeys(rows.get(task.ref)!) : [])
      return {
        comments: (await store.comments(key)).length,
        changes: (await store.history(key)).filter((each) => each.field !== 'created').length,
        files: (await store.files(key)).length,
        ...(passed.size === 0 ? {} : { gone: distinctFiles(await source.files(task.ref)).filter((file) => passed.has(file.key)).map((file) => file.name) }),
        blocks: refs(got.blocks),
        related: refs(got.related),
        parent: got.parent === null ? null : (refOf.get(got.parent) ?? null),
        milestone: got.milestone?.name ?? null,
        labels: got.labels,
        component: got.component,
      }
    }
    const check = await atStage({ stage: 'check', task: null }, () =>
      checkImport(source, (task) => atStage({ stage: 'check', task: task.id }, () => imported(task)), this.now, {
        counts,
        milestones: () => listMilestones(this.deps.db, project),
        ...(progress === undefined ? {} : { progress }),
      }),
    )
    for (const row of seen.values()) await log.save(row)
    return check
  }

  private event(level: EventLevel, said: Notice, place: EventPlace): void {
    this.deps.event?.({ level, notice: said, place })
  }
}

/** How many tasks reached each stage; `tasks` — those the import took up so far. */
export function importProgress(rows: readonly ImportRow[]): ImportState['progress'] {
  const reached = (stage: ImportRow['stage']) => rows.filter((row) => IMPORT_STAGES.indexOf(row.stage) >= IMPORT_STAGES.indexOf(stage)).length
  return { tasks: rows.length, created: reached('created'), linked: reached('linked'), attached: reached('attached'), journaled: reached('journaled'), done: reached('done') }
}
