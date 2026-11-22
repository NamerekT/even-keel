import type { ImportMilestone, ImportSource } from '../tracker/import.js'
import type { OpenedImportSource } from '../tracker/import-source.js'
import { countTasks, type CountedTask, type ImportPlanning } from '../tracker/import-plan.js'
import { notice, NoticeError } from '../notice/notice.js'
import { abortableSource, sourceBusy } from '../tracker/import-retry.js'
import { errorText } from '../tracker/link.js'

/**
 * How long a read history stays after its last ask: the window open over the plan, each pick of an author asking again,
 * and the start after it. A start past it reads the source again.
 */
export const PLAN_KEEP_MS = 30 * 60_000

/** The source's whole history as the plan counts it: an author's pick counts again from it, the start takes it. */
export interface PlanRead {
  /** The tracker it was read from: a start on another one reads again. */
  from: { tracker: string; place: string; key: string }
  source: Pick<ImportSource, 'changes' | 'timeReports' | 'milestoneGaps'>
  counted: CountedTask[]
  milestones: ImportMilestone[]
}

interface Entry {
  read: Promise<PlanRead>
  /** `planning` is `null` once the read is through. */
  progress: { planning: ImportPlanning | null }
  usedAt: number
  /** The window's own read, which its close stops; the start's read has none. */
  stop?: AbortController
}

export interface PlanReadsDeps {
  /** `signal` aborted — the source sends nothing more, a pause between tries included. */
  open: (project: string, signal?: AbortSignal) => Promise<OpenedImportSource>
  say: (line: string) => void
  now: () => number
  keepMs?: number
}

/**
 * One read of a project's history for its import's plan (BTN-1452): a second ask while it goes waits for it, an ask
 * after it takes what it read for `PLAN_KEEP_MS`. A read that failed is not kept, nor one its window's close stopped.
 */
export class PlanReads {
  private readonly entries = new Map<string, Entry>()

  constructor(private readonly deps: PlanReadsDeps) {}

  /** The read going on, the one kept, else a new read of the project's tracker. */
  get(project: string): Promise<PlanRead> {
    this.sweep()
    const kept = this.entries.get(project)
    if (kept === undefined) return this.begin(project, null)
    kept.usedAt = this.deps.now()
    return kept.read
  }

  /**
   * For the start: the read kept of the tracker `opened` reads, else a read of `opened`, left open. The read is dropped
   * either way: the import's records keep the plan from here.
   */
  async take(project: string, opened: OpenedImportSource): Promise<PlanRead> {
    this.sweep()
    const kept = this.entries.get(project)
    try {
      const read = kept === undefined ? null : await kept.read.catch(() => null)
      if (read !== null && sameTracker(read.from, opened)) return read
      return await this.begin(project, opened)
    } finally {
      this.entries.delete(project)
    }
  }

  /** The read going on; `null` — none. */
  planning(project: string): ImportPlanning | null {
    return this.entries.get(project)?.progress.planning ?? null
  }

  /**
   * Stops the window's read going on (BTN-1453): its window closed. The tracker is asked nothing more, nothing is kept,
   * and whoever waits on it hears `import.planStopped`. A read that is through and the start's read are left; `false` —
   * there was no read to stop.
   */
  stop(project: string): boolean {
    const entry = this.entries.get(project)
    if (entry?.stop === undefined || entry.progress.planning === null) return false
    this.entries.delete(project)
    entry.progress.planning = null
    this.deps.say(`import: ${project}: the plan's read is stopped, its window closed`)
    entry.stop.abort(new NoticeError(notice('import.planStopped', {})))
    return true
  }

  private begin(project: string, given: OpenedImportSource | null): Promise<PlanRead> {
    const progress: Entry['progress'] = { planning: { done: 0, total: 0 } }
    const stop = given === null ? new AbortController() : undefined
    const entry: Entry = { read: this.read(project, given, progress, stop?.signal), progress, usedAt: this.deps.now(), ...(stop === undefined ? {} : { stop }) }
    this.entries.set(project, entry)
    entry.read.then(
      () => {
        progress.planning = null
        entry.usedAt = this.deps.now()
      },
      (error: unknown) => {
        if (stop?.signal.aborted !== true) this.deps.say(`import: ${project}: the plan's read stopped: ${errorText(error)}`)
        if (this.entries.get(project) === entry) this.entries.delete(project)
      },
    )
    return entry.read
  }

  /** Reads the history from `given`, left open, else from the project's tracker opened and closed for it. */
  private async read(project: string, given: OpenedImportSource | null, progress: Entry['progress'], signal?: AbortSignal): Promise<PlanRead> {
    const opened = given ?? (await this.deps.open(project, signal))
    try {
      signal?.throwIfAborted()
      const started = this.deps.now()
      this.deps.say(`import: ${project}: the plan reads the whole history of ${opened.title}`)
      const source = signal === undefined ? opened.source : abortableSource(opened.source, signal)
      const counted = await countTasks(source, (done, total) => {
        if (signal?.aborted !== true) progress.planning = { done, total }
      })
      const milestones = await source.milestones()
      this.deps.say(`import: ${project}: the plan read ${counted.length} tasks of ${opened.title} in ${Math.round((this.deps.now() - started) / 1000)} s`)
      const { changes, timeReports, milestoneGaps } = opened.source
      return {
        from: { tracker: opened.tracker, place: opened.place, key: opened.key },
        // Only whether the source has them: the plan keeps no hold on the source.
        source: { ...(changes === undefined ? {} : { changes: async () => [] }), ...(timeReports === undefined ? {} : { timeReports }), ...(milestoneGaps === undefined ? {} : { milestoneGaps }) },
        counted,
        milestones,
      }
    } catch (error) {
      const busy = sourceBusy(error)
      if (busy === null) throw error
      // The refusal itself goes only to the log: the person reads that the tracker was overloaded.
      this.deps.say(`import: ${project}: the plan's read: ${errorText(busy)}`)
      throw new NoticeError(notice('import.planBusy', { tracker: opened.title, tries: busy.tries }), { cause: error })
    } finally {
      if (given === null) await opened.close().catch(() => {})
    }
  }

  private sweep(): void {
    const now = this.deps.now()
    for (const [project, entry] of this.entries) {
      if (entry.progress.planning === null && now - entry.usedAt > (this.deps.keepMs ?? PLAN_KEEP_MS)) this.entries.delete(project)
    }
  }
}

const sameTracker = (from: PlanRead['from'], opened: OpenedImportSource) => from.tracker === opened.tracker && from.place === opened.place && from.key === opened.key
