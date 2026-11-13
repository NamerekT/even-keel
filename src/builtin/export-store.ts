import { inTransaction, type Db, type Queryable } from '../storage/database.js'
import type { TaskMoved, TaskRef } from '../tracker/card.js'
import type { ExportLog, ExportRow, ExportStage, ExportTargetFields } from '../tracker/export.js'

export type { ExportTargetFields }

export interface ExportHeader extends ExportTargetFields {
  startedAt: string
  /** `null` — not finished. */
  finishedAt: string | null
}

/** The copy of each built-in project in the state database (step 49): its target and each task's progress. */
export class ExportRecords {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async header(project: string): Promise<ExportHeader | null> {
    const { rows } = await this.db.query<{ profile: string; place: string; key: string; started_at: string; finished_at: string | null }>(
      'select profile, place, key, started_at, finished_at from tracker_exports where project_id = $1',
      [project],
    )
    const row = rows[0]
    return row === undefined ? null : { profile: row.profile, place: row.place, key: row.key, startedAt: row.started_at, finishedAt: row.finished_at }
  }

  /** Starts the copy to `target`, dropping the progress of an earlier target: the caller refuses that once a task was created. */
  begin(project: string, target: ExportTargetFields): Promise<void> {
    return inTransaction(this.db, async (tx) => {
      await tx.query('delete from tracker_export_tasks where project_id = $1', [project])
      await tx.query(
        `insert into tracker_exports (project_id, profile, place, key, started_at, finished_at) values ($1, $2, $3, $4, $5, null)
           on conflict (project_id) do update set profile = excluded.profile, place = excluded.place, key = excluded.key,
             started_at = excluded.started_at, finished_at = null`,
        [project, target.profile, target.place, target.key, this.now().toISOString()],
      )
    })
  }

  /** A finished copy goes on to the same target, for the tasks filed since: its rows stay. */
  async reopen(project: string): Promise<void> {
    await this.db.query('update tracker_exports set finished_at = null where project_id = $1', [project])
  }

  async finish(project: string): Promise<void> {
    await this.db.query('update tracker_exports set finished_at = $2 where project_id = $1', [project, this.now().toISOString()])
  }

  rows(project: string): Promise<ExportRow[]> {
    return exportRows(this.db, project)
  }

  log(project: string): ExportLog {
    return {
      rows: () => this.rows(project),
      save: async (row) => {
        await this.db.query(
          `insert into tracker_export_tasks (project_id, task_id, number, new_key, url, stage, marker, done, at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             on conflict (project_id, task_id) do update set number = excluded.number, new_key = excluded.new_key, url = excluded.url,
               stage = excluded.stage, marker = excluded.marker, done = excluded.done, at = excluded.at`,
          [project, row.ref, row.number, row.key, row.url, row.stage, row.marker, row.done, this.now().toISOString()],
        )
      },
    }
  }
}

/**
 * The copied tasks of the projects by `<project> <number>`: the new task of each one whose copy is through (BTN-1075),
 * for the page's search and a card's links, which still show the old task.
 */
export async function movedTasks(db: Queryable, projects: readonly string[]): Promise<Map<string, TaskMoved>> {
  if (projects.length === 0) return new Map()
  const { rows } = await db.query<{ project_id: string; number: number; new_key: string; url: string | null }>(
    `select project_id, number, new_key, url from tracker_export_tasks where project_id = any($1) and stage = 'marked' and new_key is not null`,
    [[...projects]],
  )
  return new Map(rows.map((row) => [movedName(row.project_id, row.number), { key: row.new_key, url: row.url }]))
}

export const movedName = (project: string, number: number): string => `${project} ${number}`

export function withMoved(ref: TaskRef, moved: TaskMoved | undefined): TaskRef {
  return moved === undefined ? ref : { ...ref, moved }
}

/** The project's copied tasks by number: the old task's new key, for the switch (#2) and Tally (#4). */
export async function exportRows(db: Queryable, project: string): Promise<ExportRow[]> {
  const { rows } = await db.query<{ task_id: string; number: number; new_key: string | null; url: string | null; stage: ExportStage; marker: string | null; done: number }>(
    'select task_id, number, new_key, url, stage, marker, done from tracker_export_tasks where project_id = $1 order by number',
    [project],
  )
  return rows.map((row) => ({ ref: row.task_id, number: row.number, key: row.new_key, url: row.url, stage: row.stage, marker: row.marker, done: row.done }))
}
