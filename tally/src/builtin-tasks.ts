import { BUILTIN, builtinStatus } from '../../src/builtin/model.js'
import type { Queryable } from '../../src/storage/database.js'
import type { TaskRecord } from './huly.js'

// The projects on the built-in tracker now: a project that left it keeps its rows, but its key names another tracker's tasks.
const BUILTIN_TASKS = `
with places as (
  select p.id, p.key from projects p
  where exists (select 1 from setting_values v where v.key = 'tracker' and v.project_id = p.id and v.qualifier = '' and v.value = $1)
)
select
  p.key || '-' || t.number as task, t.title, t.status, t.priority, m.name as milestone, t.created_at,
  coalesce((
    select array_agg(l.name order by lower(l.name))
    from builtin_task_labels tl join builtin_labels l on l.id = tl.label_id
    where tl.task_id = t.id
  ), '{}') as labels,
  coalesce((
    select array_agg(q.key || '-' || o.number order by q.key, o.number)
    from builtin_relations r
    join builtin_tasks o on o.id = case when r.from_id = t.id then r.to_id else r.from_id end
    join places q on q.id = o.project_id
    where r.kind = 'relates' and (r.from_id = t.id or r.to_id = t.id)
  ), '{}') as related
from builtin_tasks t
join places p on p.id = t.project_id
left join builtin_milestones m on m.id = t.milestone_id
order by p.key, t.number`

interface Row {
  task: string
  title: string
  status: string
  priority: string
  milestone: string | null
  created_at: string
  labels: string[]
  related: string[]
}

/**
 * The tasks of the built-in tracker (BTN-785) from Even Keel's state database, read whole on every run: Tally gets their
 * status, labels and `relates` links here, as it gets a Huly task's from Huly. Named `<KEY>-<N>`, as the chain names them.
 */
export async function builtinTasks(db: Queryable): Promise<TaskRecord[]> {
  const { rows } = await db.query<Row>(BUILTIN_TASKS, [JSON.stringify(BUILTIN)])
  return rows.map((row) => ({
    task: row.task,
    title: row.title,
    status: row.status,
    labels: row.labels,
    related: row.related,
    priority: row.priority,
    estimateH: null,
    component: null,
    milestone: row.milestone,
    done: builtinStatus(row.status)?.category === 'Won',
    createdAt: row.created_at,
  }))
}
