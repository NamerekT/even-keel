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
  p.key || '-' || t.number as task, p.id as project, t.title, t.status, t.priority, m.name as milestone, t.created_at, t.estimate,
  c.name as component,
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
left join builtin_components c on c.id = t.component_id
order by p.key, t.number`

// The keys a project left the built-in tracker under: a switch of the transfers' history, else (a switch before step 63)
// a finished copy whose target key the project carries now (a switch before step 69). A copy without a switch leaves
// the project where it was.
const LEFTOVERS = `
with places as (
  select p.id from projects p
  where exists (select 1 from setting_values v where v.key = 'tracker' and v.project_id = p.id and v.qualifier = '' and v.value = $1)
),
gone as (
  select x.project_id, x.source_key from tracker_transfers x where x.direction = 'export' and x.source_key is not null
  union
  select e.project_id, e.source_key from tracker_exports e join projects p on p.id = e.project_id
  where e.direction = 'export' and e.source_key is not null and e.finished_at is not null and p.key = e.key
)
select distinct g.source_key || '-' || t.number as task
from gone g
join projects p on p.id = g.project_id
join builtin_tasks t on t.project_id = g.project_id
where p.id not in (select id from places)
order by 1`

interface Row {
  task: string
  project: string
  estimate: number | null
  component: string | null
  title: string
  status: string
  priority: string
  milestone: string | null
  created_at: string
  labels: string[]
  related: string[]
}

/** A task of the built-in tracker with the id of its project, which its card is opened under. */
export interface BuiltinTask extends TaskRecord {
  project: string
}

/**
 * The tasks of the built-in tracker (BTN-785) from Even Keel's state database, read whole on every run: Tally gets their
 * status, labels, `relates` links, estimate and component here, as it gets a Huly task's from Huly. Named `<KEY>-<N>`,
 * as the chain names them.
 */
export async function builtinTasks(db: Queryable): Promise<BuiltinTask[]> {
  const { rows } = await db.query<Row>(BUILTIN_TASKS, [JSON.stringify(BUILTIN)])
  return rows.map((row) => ({
    task: row.task,
    project: row.project,
    title: row.title,
    status: row.status,
    labels: row.labels,
    related: row.related,
    priority: row.priority,
    estimateH: row.estimate === null ? null : row.estimate / 60,
    component: row.component,
    milestone: row.milestone,
    done: builtinStatus(row.status)?.category === 'Won',
    createdAt: row.created_at,
  }))
}

/**
 * The old ids `<source_key>-<N>` of the rows a project switched off the built-in tracker left there (BTN-1497): the
 * closed tasks the copy skipped and the copied ones' old ids. A database before the transfers' history has none.
 */
export async function builtinLeftovers(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ task: string }>(LEFTOVERS, [JSON.stringify(BUILTIN)]).catch(() => ({ rows: [] }))
  return rows.map((row) => row.task)
}
