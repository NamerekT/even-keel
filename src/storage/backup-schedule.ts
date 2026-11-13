import { mkdirSync, rmSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { Worker } from 'node:worker_threads'
import type { PGlite } from '@electric-sql/pglite'
import { fail, notice, type Notice } from '../notice/notice.js'
import { BackupError, backupDirOf, lastChecked, makeCopy, ownName, rotate, type CopyCheck, type CopyJob } from './backup.js'
import { DEFAULT_BACKUP_KEEP, MAX_BACKUP_KEEP, type BackupView } from './backup-model.js'
import { rowsTextOf } from './copy.js'
import { databaseVersion, type BeforeSteps } from './database.js'
import { databaseDirOf, filesDirOf } from './owner.js'

// The service's daily copy of the state database (BTN-1083): the rows are read here, the copy is written and checked
// on its own thread. `docs/storage.md`, "Backup, export, rollback".

const MINUTE = 60_000
export const BACKUP_FIRST_LOOK_MS = 5 * MINUTE
export const BACKUP_LOOK_EVERY_MS = 10 * MINUTE
/** A copy is made when the newest checked one is older than this. */
export const BACKUP_EVERY_MS = 24 * 60 * MINUTE
/** A failed copy is tried again after this. */
export const BACKUP_RETRY_MS = 60 * MINUTE

export interface BackupSettings {
  /** The copies' folder, resolved: the setting or its default. */
  dir: string
  keep: number
}

export interface BackupsOptions {
  db: PGlite
  /** The attachments' folder of the database. */
  files: string
  /** Read at each copy and each view: the settings change on the fly. */
  settings: () => BackupSettings
  /** Writes and checks the copy away from the event loop; `signal` aborts it at the service's stop. */
  run: (job: CopyJob, signal: AbortSignal) => Promise<CopyCheck>
  log: (line: string) => void
  /** The view changed. */
  changed: () => void
  now?: () => Date
}

export class Backups {
  private timer: NodeJS.Timeout | null = null
  private running: Promise<void> | null = null
  private failure: Notice | null = null
  private failedAt = 0
  private last: { dir: string; at: string | null } | null = null
  private readonly abort = new AbortController()

  constructor(private readonly options: BackupsOptions) {}

  start(): void {
    this.timer = setTimeout(() => this.tick(), BACKUP_FIRST_LOOK_MS)
    this.timer.unref()
  }

  async stop(): Promise<void> {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    this.abort.abort()
    await this.running
  }

  /** The copy made before the schema steps at the start failed: shown until a copy succeeds, the first look tries one. */
  failedAtStart(failure: Notice): void {
    this.failure = failure
  }

  view(): BackupView {
    const { dir } = this.options.settings()
    return { dir, at: this.lastAt(dir), running: this.running !== null, failure: this.failure }
  }

  /** Makes a copy when the newest checked one is older than a day, unless a failed one waits for its retry. */
  async look(): Promise<void> {
    if (this.running !== null || this.abort.signal.aborted) return
    const now = this.now().getTime()
    const { dir } = this.options.settings()
    this.last = null
    const at = this.lastAt(dir)
    if (at !== null && now - Date.parse(at) < BACKUP_EVERY_MS) return
    if (this.failedAt > 0 && now - this.failedAt < BACKUP_RETRY_MS) return
    this.begin()
    await this.running
  }

  /** Starts a copy and returns at once; refused while one runs. */
  copyNow(): void {
    if (this.running !== null) throw fail('storage.backupRunning', {})
    this.begin()
  }

  /** The copy under way, if any, ended. */
  async idle(): Promise<void> {
    await this.running
  }

  private tick(): void {
    void this.look().finally(() => {
      if (this.abort.signal.aborted) return
      this.timer = setTimeout(() => this.tick(), BACKUP_LOOK_EVERY_MS)
      this.timer.unref()
    })
  }

  private begin(): void {
    this.running = this.copy().finally(() => {
      this.running = null
      this.last = null
      this.options.changed()
    })
    this.options.changed()
  }

  private async copy(): Promise<void> {
    const { db, files, run, log } = this.options
    const { dir, keep } = this.options.settings()
    let target: string | null = null
    try {
      mkdirSync(dir, { recursive: true })
      const from = performance.now()
      const rows = await rowsTextOf(db)
      const version = await databaseVersion(db)
      log(`storage: the backup read the database in ${Math.round(performance.now() - from)} ms`)
      target = join(dir, ownName(this.now(), version))
      const check = await run({ rows, version, dir: target, files }, this.abort.signal)
      const gone = rotate(dir, keep)
      log(`storage: the backup ${target} is checked: ${Object.keys(check.tables).length} tables, ${check.files} files${gone.length > 0 ? `; removed ${gone.join(', ')}` : ''}`)
      this.failure = null
      this.failedAt = 0
    } catch (error) {
      if (target !== null) rmSync(target, { recursive: true, force: true })
      if (this.abort.signal.aborted) return
      const stage = error instanceof BackupError ? error.stage : 'copy'
      log(`storage: the backup into ${target ?? dir} failed at the ${stage}: ${error instanceof Error ? error.message : String(error)}`)
      this.failure = notice(stage === 'check' ? 'storage.backupCheckFailed' : 'storage.backupFailed', {})
      this.failedAt = this.now().getTime()
    }
  }

  private lastAt(dir: string): string | null {
    if (this.last?.dir !== dir) this.last = { dir, at: lastChecked(dir)?.check?.at ?? null }
    return this.last.at
  }

  private now(): Date {
    return this.options.now?.() ?? new Date()
  }
}

let startFailure: Notice | null = null

/** The failure of the copy made before the schema steps, once: the service's `Backups` shows it. */
export function takeStartFailure(): Notice | null {
  const failure = startFailure
  startFailure = null
  return failure
}

/**
 * The copy made at the start before an existing database takes new schema steps, on its old schema: in this thread,
 * the service does not run yet. The settings are read from their rows as they are; a failure does not stop the start.
 */
export function copyBeforeSteps(stateDir: string, log: (line: string) => void): BeforeSteps {
  return async (db, from) => {
    const { dir, keep } = await storedSettings(db, stateDir)
    const target = join(dir, ownName(new Date(), from))
    try {
      mkdirSync(dir, { recursive: true })
      const check = await makeCopy({ rows: await rowsTextOf(db), version: from, dir: target, files: filesDirOf(databaseDirOf(stateDir)) })
      const gone = rotate(dir, keep)
      log(`storage: the copy before the schema steps from ${from} is checked in ${target}: ${check.files} files${gone.length > 0 ? `; removed ${gone.join(', ')}` : ''}`)
    } catch (error) {
      rmSync(target, { recursive: true, force: true })
      const stage = error instanceof BackupError ? error.stage : 'copy'
      log(`storage: the copy before the schema steps from ${from} into ${target} failed at the ${stage}, the start goes on: ${error instanceof Error ? error.message : String(error)}`)
      startFailure = notice(stage === 'check' ? 'storage.backupCheckFailed' : 'storage.backupFailed', {})
    }
  }
}

async function storedSettings(db: PGlite, stateDir: string): Promise<BackupSettings> {
  const values = new Map<string, unknown>()
  try {
    const { rows } = await db.query<{ key: string; value: string }>(
      "select key, value from setting_values where key in ('backup.dir', 'backup.keep') and project_id is null and qualifier = ''",
    )
    for (const { key, value } of rows) values.set(key, JSON.parse(value))
  } catch {
    // A schema from before the settings' rows, or a value that does not parse: the defaults.
  }
  const dir = values.get('backup.dir')
  const keep = values.get('backup.keep')
  return {
    dir: backupDirOf(stateDir, typeof dir === 'string' && isAbsolute(dir) ? dir : null),
    keep: Number.isInteger(keep) && (keep as number) >= 1 && (keep as number) <= MAX_BACKUP_KEEP ? (keep as number) : DEFAULT_BACKUP_KEEP,
  }
}

// The sources under tsx, the compiled `dist/src/storage/` from the build.
const workerFile = new URL(`./backup-worker${import.meta.url.endsWith('.ts') ? '.ts' : '.js'}`, import.meta.url)

/** What the backup's thread answers: the check, or the stage that failed. */
export type CopyAnswer = { check: CopyCheck } | { stage: BackupError['stage']; error: string }

/** `Backups`' `run` of the service: the copy on its own thread, terminated on abort. */
export function copyOnThread(job: CopyJob, signal: AbortSignal): Promise<CopyCheck> {
  return new Promise((resolve, reject) => {
    const thread = new Worker(workerFile, { workerData: job })
    let answer: CopyAnswer | null = null
    const onAbort = () => void thread.terminate()
    signal.addEventListener('abort', onAbort, { once: true })
    thread.on('message', (message: CopyAnswer) => {
      answer = message
      void thread.terminate()
    })
    thread.on('error', (error) => {
      answer ??= { stage: 'copy', error: error.stack ?? error.message }
    })
    thread.on('exit', () => {
      signal.removeEventListener('abort', onAbort)
      if (answer !== null && 'check' in answer) resolve(answer.check)
      else reject(new BackupError(answer?.stage ?? 'copy', answer?.error ?? 'the thread ended without an answer'))
    })
  })
}
