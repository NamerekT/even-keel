import type { Queryable } from '../storage/database.js'
import type { StoredRun } from './runs.js'

export async function loadTaskRuns(db: Queryable): Promise<StoredRun[]> {
  const { rows } = await db.query<{ project_id: string; task: string; provider: string | null; model: string | null; effort: string | null }>(
    'select project_id, task, provider, model, effort from task_runs order by project_id, task',
  )
  return rows.map((row) => ({ project: row.project_id, task: row.task, provider: row.provider, model: row.model, effort: row.effort }))
}

/** Starts its write at the call: see `Writes`. */
export async function saveTaskRun(db: Queryable, run: StoredRun): Promise<void> {
  await db.query(
    `insert into task_runs (project_id, task, provider, model, effort) values ($1, $2, $3, $4, $5)
       on conflict (project_id, task) do update set provider = excluded.provider, model = excluded.model, effort = excluded.effort`,
    [run.project, run.task, run.provider, run.model, run.effort],
  )
}

export async function dropTaskRun(db: Queryable, project: string, task: string): Promise<void> {
  await db.query('delete from task_runs where project_id = $1 and task = $2', [project, task])
}

/** The projects whose run labels are still to be moved into runs. */
export async function loadRunImports(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ project_id: string }>('select project_id from run_label_imports order by project_id')
  return rows.map((row) => row.project_id)
}

export async function dropRunImport(db: Queryable, project: string): Promise<void> {
  await db.query('delete from run_label_imports where project_id = $1', [project])
}
