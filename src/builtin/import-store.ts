import { inTransaction, type Db } from '../storage/database.js'
import type { ImportAuthorChoice, ImportPlan } from '../tracker/import-plan.js'
import type { TransferCheck } from '../tracker/transfer-check.js'
import type { ImportLog, ImportRow, ImportSeen, ImportStage } from './import-run.js'

/** Where a project's history is imported from: the tracker it is on and its place there. */
export interface ImportFrom {
  /** The adapter's kind. */
  tracker: string
  place: string
  /** The prefix of the tasks' ids, kept by the built-in tracker. */
  key: string
}

export interface ImportHeader extends ImportFrom {
  startedAt: string
  /** `null` — not finished. */
  finishedAt: string | null
  authors: ImportAuthorChoice[]
  /** The plan as the person saw it at the start; `null` — not saved yet. */
  plan: ImportPlan | null
  /** The check after the last run; `null` — none yet. */
  checked: TransferCheck | null
}

/** The import of each project into the built-in tracker in the state database (step 71, BTN-1405). */
export class ImportRecords {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async header(project: string): Promise<ImportHeader | null> {
    const { rows } = await this.db.query<{
      tracker: string
      place: string
      key: string
      started_at: string
      finished_at: string | null
      authors: string
      plan: string | null
      checked: string | null
    }>('select tracker, place, key, started_at, finished_at, authors, plan, checked from tracker_imports where project_id = $1', [project])
    const row = rows[0]
    if (row === undefined) return null
    return {
      tracker: row.tracker,
      place: row.place,
      key: row.key,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      authors: JSON.parse(row.authors) as ImportAuthorChoice[],
      plan: row.plan === null ? null : (JSON.parse(row.plan) as ImportPlan),
      checked: row.checked === null ? null : (JSON.parse(row.checked) as TransferCheck),
    }
  }

  /** Starts the import with the authors as the plan chose them, dropping any progress of an earlier one. */
  begin(project: string, from: ImportFrom, authors: readonly ImportAuthorChoice[], plan: ImportPlan): Promise<void> {
    return inTransaction(this.db, async (tx) => {
      await tx.query('delete from tracker_import_tasks where project_id = $1', [project])
      await tx.query(
        `insert into tracker_imports (project_id, tracker, place, key, started_at, finished_at, authors, plan, checked)
           values ($1, $2, $3, $4, $5, null, $6, $7, null)
           on conflict (project_id) do update set tracker = excluded.tracker, place = excluded.place, key = excluded.key,
             started_at = excluded.started_at, finished_at = null, authors = excluded.authors, plan = excluded.plan, checked = null`,
        [project, from.tracker, from.place, from.key, this.now().toISOString(), JSON.stringify(authors), JSON.stringify(plan)],
      )
    })
  }

  async reopen(project: string): Promise<void> {
    await this.db.query('update tracker_imports set finished_at = null where project_id = $1', [project])
  }

  async finish(project: string): Promise<void> {
    await this.db.query('update tracker_imports set finished_at = $2 where project_id = $1', [project, this.now().toISOString()])
  }

  /** `null` — the last count failed: no check to switch by. */
  async saveCheck(project: string, check: TransferCheck | null): Promise<void> {
    await this.db.query('update tracker_imports set checked = $2 where project_id = $1', [project, check === null ? null : JSON.stringify(check)])
  }

  /** The import is over once the project switched: its record goes, the report stays (`tracker_transfers`). */
  forget(project: string): Promise<void> {
    return inTransaction(this.db, async (tx) => {
      await tx.query('delete from tracker_import_tasks where project_id = $1', [project])
      await tx.query('delete from tracker_imports where project_id = $1', [project])
    })
  }

  async rows(project: string): Promise<ImportRow[]> {
    const { rows } = await this.db.query<{ task_ref: string; number: number; stage: ImportStage; done: number; files: string; changes: number; seen: string | null }>(
      'select task_ref, number, stage, done, files, changes, seen from tracker_import_tasks where project_id = $1 order by number',
      [project],
    )
    return rows.map((row) => ({
      ref: row.task_ref,
      number: row.number,
      stage: row.stage,
      done: row.done,
      files: JSON.parse(row.files) as Record<string, string>,
      changes: row.changes,
      seen: row.seen === null ? null : (JSON.parse(row.seen) as ImportSeen),
    }))
  }

  log(project: string): ImportLog {
    return {
      rows: () => this.rows(project),
      save: async (row) => {
        await this.db.query(
          `insert into tracker_import_tasks (project_id, task_ref, number, stage, done, files, changes, at, seen) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             on conflict (project_id, task_ref) do update set number = excluded.number, stage = excluded.stage, done = excluded.done,
               files = excluded.files, changes = excluded.changes, at = excluded.at, seen = excluded.seen`,
          [project, row.ref, row.number, row.stage, row.done, JSON.stringify(row.files), row.changes, this.now().toISOString(), row.seen === null ? null : JSON.stringify(row.seen)],
        )
      },
    }
  }
}
