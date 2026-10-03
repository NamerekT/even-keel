import { BASE } from './base-sql.js'
import type { PeriodQuery, StatsFilter } from './model.js'
import {
  parseStepSettings,
  shareOf,
  stepsOf,
  taskSteps,
  taskTime,
  type StatsSteps,
  type StatsTaskStep,
  type StatsUnknownStep,
  type StepRunRow,
  type TaskTime,
} from './steps.js'

type Row = Record<string, unknown>

export interface StepsDb {
  base(sql: string, filter: StatsFilter, extra: unknown[]): Promise<Row[]>
  plain(sql: string, params: unknown[]): Promise<Row[]>
}

const TOP_UNKNOWN = 15
const UNKNOWN_MIN_SECONDS = 10

// $8 first day, $9 last day, both local and inclusive; $10 project labels or null for all. A run belongs to the
// project of the message that launched it. Runs start a week early so the first week of the period has one to grow from.
const RUNS = `${BASE}, bounds as (
  select ($8::date)::timestamp at time zone $3::text as lo,
    ($9::date + 1)::timestamp at time zone $3::text as hi
), runs as (
  select r.*, r.started_at >= bounds.lo as cur
  from step_runs_x r
  join tool_calls tc on tc.tool_use_id = r.tool_use_id
  join base b on b.message_id = tc.message_id
  cross join bounds
  where r.started_at >= bounds.lo - interval '7 days' and r.started_at < bounds.hi
    and ($10::text[] is null or b.project = any($10::text[]))
)`

const STEP_RUNS = `${RUNS}
select r.step, r.task, to_char(date_trunc('week', r.started_at at time zone $3::text), 'YYYY-MM-DD') as week,
  r.started_at, r.ended_at, r.seconds, coalesce(r.cold, false) as cold, r.outcome, r.cur
from runs r
where r.step is not null`

const UNKNOWN = `${RUNS}
select r.signature, count(*) as n, sum(r.seconds) as seconds, max(r.seconds) as max,
  (array_agg(r.command order by r.seconds desc))[1] as command
from runs r
where r.cur and r.step is null and r.signature <> '' and r.end_by not in ('stop', 'open') and r.outcome is distinct from 'killed'
group by r.signature
having max(r.seconds) >= ${UNKNOWN_MIN_SECONDS}
order by seconds desc
limit ${TOP_UNKNOWN}`

const SETTINGS = `select value from tally_meta where name = 'steps'`

// $1 task ids: all their step runs, turns and active time, whatever the period.
const TASK_RUNS = `select task, step, started_at, ended_at from step_runs_x where step is not null and task = any($1::text[])`
const TASK_TURNS = `
select st.task, t.started_at, t.ended_at
from turns t
join session_tasks st on st.session_id = t.session_id
where st.task = any($1::text[])`
const TASK_ACTIVE = `select task, active_s from task_times where task = any($1::text[]) and active_s is not null`

const ms = (value: unknown): number => (value instanceof Date ? value.getTime() : Date.parse(String(value)))
const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value))

export function mapRuns(rows: Row[]): StepRunRow[] {
  return rows.map((row) => ({
    step: String(row.step),
    task: text(row.task),
    week: String(row.week),
    startedAt: ms(row.started_at),
    endedAt: ms(row.ended_at),
    seconds: Number(row.seconds),
    cold: row.cold === true,
    outcome: text(row.outcome),
    current: row.cur === true,
  }))
}

export function mapUnknown(rows: Row[]): StatsUnknownStep[] {
  return rows.map((row) => ({
    signature: String(row.signature),
    n: Number(row.n),
    seconds: Number(row.seconds),
    max: Number(row.max),
    command: String(row.command ?? ''),
  }))
}

export function taskTimes(runs: Row[], turns: Row[], active: Row[]): Map<string, TaskTime> {
  const times = new Map<string, TaskTime>()
  for (const row of active) {
    const task = String(row.task)
    const own = runs
      .filter((each) => each.task === task)
      .map((each) => ({ step: String(each.step), startedAt: ms(each.started_at), endedAt: ms(each.ended_at) }))
    const spans = turns.filter((each) => each.task === task).map((each) => ({ from: ms(each.started_at), to: ms(each.ended_at) }))
    times.set(task, taskTime(own, spans, Number(row.active_s)))
  }
  return times
}

async function readTimes(db: StepsDb, tasks: string[]): Promise<Map<string, TaskTime>> {
  if (tasks.length === 0) return new Map()
  const [runs, turns, active] = await Promise.all([TASK_RUNS, TASK_TURNS, TASK_ACTIVE].map((sql) => db.plain(sql, [tasks])))
  return taskTimes(runs!, turns!, active!)
}

export async function readSteps(db: StepsDb, query: PeriodQuery): Promise<StatsSteps> {
  const extra = [query.from, query.to, query.projects]
  const [runRows, unknownRows, settingRows] = await Promise.all([
    db.base(STEP_RUNS, query, extra),
    db.base(UNKNOWN, query, extra),
    db.plain(SETTINGS, []),
  ])
  const raw = settingRows[0]?.value
  const settings = parseStepSettings(typeof raw === 'string' ? JSON.parse(raw) : raw)
  const runs = mapRuns(runRows)
  const tasks = [...new Set(runs.filter((run) => run.current && run.task !== null).map((run) => run.task!))].sort()
  const times = await readTimes(db, tasks)
  return {
    query,
    at: new Date().toISOString(),
    settings,
    tasks: times.size,
    steps: stepsOf(runs, settings, shareOf([...times.values()])),
    unknown: mapUnknown(unknownRows),
  }
}

export async function readTaskSteps(db: StepsDb, task: string): Promise<StatsTaskStep[]> {
  const time = (await readTimes(db, [task])).get(task)
  return time === undefined ? [] : taskSteps(time)
}
