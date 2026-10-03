import pg from 'pg'
import type { ProjectStats, ReaderSettings, StatsAnswer, StatsQuery } from './model.js'
import { repoTail } from './model.js'

const CACHE_MS = 60_000
const TOP_TASKS = 10
const TOP_REPEATS = 10
const TOP_STUCK = 20

// $1 project key, $2 repository path without drive, $3 days, $4 scope.
const SCOPED = `
with scoped as (
  select c.message_id, c.session_id, c.task, c.at, c.cost
  from message_costs c
  left join sessions s on s.session_id = c.session_id
  cross join lateral (
    select lower(regexp_replace(replace(coalesce(c.project_dir, ''), '\\', '/'), '^[a-zA-Z]:', '')) as dir
  ) d
  where c.at >= now() - make_interval(days => $3::int * 2)
    and ($4::text = 'all' or s.launch_reason is not null)
    and (c.task like $1::text || '-%' or (c.task is null and (d.dir = $2::text or starts_with(d.dir, $2::text || '/'))))
), cur as (
  select * from scoped where at >= now() - make_interval(days => $3::int)
), shares as (
  select l.message_id, l.span, l.share, cur.task from limit_shares l join cur using (message_id)
)`

const TOTAL = `${SCOPED}
select
  (select now() - make_interval(days => $3::int)) as since,
  coalesce((select sum(cost) from cur), 0) as cost,
  coalesce((select sum(cost) from scoped where at < now() - make_interval(days => $3::int)), 0) as previous_cost,
  (select count(*) from cur) as messages,
  (select count(distinct session_id) from cur) as sessions,
  (select count(*) from cur where cost is null) as unpriced,
  (select sum(share) from shares where span = '5h') as five_hour,
  (select sum(share) from shares where span = '7d') as seven_day,
  coalesce((select sum(cost) from cur where task is null), 0) as service_cost,
  (select count(distinct session_id) from cur where task is null) as service_sessions`

const TASKS = `${SCOPED}
select c.task, t.title, t.status, sum(c.cost) as cost, count(distinct c.session_id) as sessions,
  (select sum(share) from shares where shares.task = c.task and span = '7d') as seven_day
from cur c
left join tasks t on t.task = c.task
where c.task is not null
group by c.task, t.title, t.status
order by cost desc nulls last
limit ${TOP_TASKS}`

const REPEATS = `${SCOPED}
select r.task, r.title, r.status, r.sessions, r.relays, r.checkpoints, r.restarts, r.spans, r.rework
from task_repeats r
where r.task in (select task from cur) and (r.sessions > 1 or r.rework or r.spans > 0)
order by r.sessions desc, r.spans desc, r.task
limit ${TOP_REPEATS}`

const STUCK = `${SCOPED}
select sp.id, sp.task, sp.session_id, sp.from_at, sp.to_at, sp.kinds, sp.reason, sp.note
from stuck_spans sp
where sp.session_id in (select session_id from cur) and sp.to_at >= now() - make_interval(days => $3::int)
order by sp.to_at desc
limit ${TOP_STUCK}`

const REASONS = `${SCOPED}
select sp.reason, count(*) as spans
from stuck_spans sp
where sp.session_id in (select session_id from cur) and sp.to_at >= now() - make_interval(days => $3::int)
group by sp.reason
order by spans desc, sp.reason nulls last`

type Row = Record<string, unknown>

const number = (value: unknown): number => Number(value ?? 0)
const maybe = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value))
const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value))
const iso = (value: unknown): string => (value instanceof Date ? value.toISOString() : String(value))

export interface StatsRows {
  total: Row
  tasks: Row[]
  repeats: Row[]
  stuck: Row[]
  reasons: Row[]
}

export function mapStats(project: string, query: StatsQuery, rows: StatsRows, at: Date): ProjectStats {
  const { total } = rows
  return {
    project,
    query,
    since: iso(total.since),
    at: at.toISOString(),
    total: {
      cost: number(total.cost),
      previousCost: number(total.previous_cost),
      messages: number(total.messages),
      sessions: number(total.sessions),
      unpriced: number(total.unpriced),
      fiveHour: maybe(total.five_hour),
      sevenDay: maybe(total.seven_day),
    },
    service: { cost: number(total.service_cost), sessions: number(total.service_sessions) },
    tasks: rows.tasks.map((row) => ({
      task: String(row.task),
      title: text(row.title),
      status: text(row.status),
      cost: number(row.cost),
      sessions: number(row.sessions),
      sevenDay: maybe(row.seven_day),
    })),
    repeats: rows.repeats.map((row) => ({
      task: String(row.task),
      title: text(row.title),
      status: text(row.status),
      sessions: number(row.sessions),
      relays: number(row.relays),
      checkpoints: number(row.checkpoints),
      restarts: number(row.restarts),
      spans: number(row.spans),
      rework: row.rework === true,
    })),
    stuck: rows.stuck.map((row) => ({
      id: String(row.id),
      task: text(row.task),
      sessionId: String(row.session_id),
      fromAt: iso(row.from_at),
      toAt: iso(row.to_at),
      kinds: (row.kinds as string[] | null) ?? [],
      reason: text(row.reason),
      note: text(row.note),
    })),
    reasons: rows.reasons.map((row) => ({ reason: text(row.reason), spans: number(row.spans) })),
  }
}

export class StatsReader {
  private readonly pool: pg.Pool | null
  private readonly cache = new Map<string, { at: number; answer: StatsAnswer }>()

  constructor(private readonly settings: ReaderSettings | string) {
    this.pool =
      typeof settings === 'string'
        ? null
        : new pg.Pool({ ...settings, max: 2, connectionTimeoutMillis: 5_000, statement_timeout: 20_000, idleTimeoutMillis: 60_000 })
    this.pool?.on('error', () => {})
  }

  async project(project: string, repo: string, query: StatsQuery): Promise<StatsAnswer> {
    if (this.pool === null) return { state: 'off', reason: `не заданы ${this.settings as string} в .env` }
    const key = `${project}|${query.days}|${query.scope}`
    const cached = this.cache.get(key)
    if (cached !== undefined && Date.now() - cached.at < CACHE_MS) return cached.answer
    const answer = await this.read(this.pool, project, repo, query)
    this.cache.set(key, { at: Date.now(), answer })
    return answer
  }

  private async read(pool: pg.Pool, project: string, repo: string, query: StatsQuery): Promise<StatsAnswer> {
    const params = [project, repoTail(repo), query.days, query.scope]
    try {
      const [total, tasks, repeats, stuck, reasons] = await Promise.all(
        [TOTAL, TASKS, REPEATS, STUCK, REASONS].map((sql) => pool.query<Row>(sql, params).then((result) => result.rows)),
      )
      const rows = { total: total![0]!, tasks: tasks!, repeats: repeats!, stuck: stuck!, reasons: reasons! }
      return { state: 'ok', stats: mapStats(project, query, rows, new Date()) }
    } catch (error) {
      return { state: 'error', error: error instanceof Error ? error.message : String(error) }
    }
  }
}
