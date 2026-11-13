import { BUILTIN } from '../../src/builtin/model.js'
import type { Queryable } from '../../src/storage/database.js'

/** An old id of a built-in task and the id of its copy in the tracker the project switched to (BTN-1076). */
export interface TaskMove {
  old: string
  task: string
}

// Only a project that left the built-in tracker: before the switch the old task is the one the chain works.
const MOVES = `
select e.source_key || '-' || t.number as old, t.new_key as task
from tracker_export_tasks t
join tracker_exports e on e.project_id = t.project_id
where t.stage = 'marked' and t.new_key is not null and e.source_key is not null
  and not exists (
    select 1 from setting_values v where v.key = 'tracker' and v.project_id = t.project_id and v.qualifier = '' and v.value = $1
  )
order by e.source_key, t.number`

/**
 * The copied tasks of the projects switched off the built-in tracker, from Even Keel's state database (`source_key` of
 * step 50, `tracker_export_tasks` of BTN-1073). A database before step 50 has none.
 */
export async function taskMoves(db: Queryable): Promise<TaskMove[]> {
  const { rows } = await db.query<{ old: string; task: string }>(MOVES, [JSON.stringify(BUILTIN)]).catch(() => ({ rows: [] }))
  return rows.map((row) => ({ old: row.old, task: row.task }))
}

/**
 * $1 — `TaskMove[]`. Each link is kept (a project forgotten by Even Keel keeps its tasks' links), and the new task's
 * row, while no tracker gave it a title, takes the old task's.
 */
export const TASK_MOVES = `
with x as (select old, task from jsonb_to_recordset($1::jsonb) as x(old text, task text)),
moved as (
  insert into task_moves (old_task, task) select old, task from x
  on conflict (old_task) do update set task = excluded.task where task_moves.task is distinct from excluded.task
)
insert into tasks (task, title, fetched_at)
select x.task, t.title, 'epoch' from x join tasks t on t.task = x.old where coalesce(t.title, '') <> ''
on conflict (task) do update set title = excluded.title where coalesce(tasks.title, '') = ''`
