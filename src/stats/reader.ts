import pg from 'pg'
import type {
  PeriodQuery,
  ReaderSettings,
  StatsAnswer,
  StatsCell,
  StatsFilter,
  StatsHistory,
  StatsPeriod,
  StatsStuck,
  StatsTaskDetail,
  StatsTotals,
} from './model.js'
import type { CompareSettings } from '../config.js'
import { BASE } from './base-sql.js'
import { folderGroups, repoTail } from './model.js'
import { readCompare, readRuleDiff, readRules, type RulesDb } from './rules-reader.js'
import type { CompareQuery, RuleDiffFile, RulesQuery, StatsCompare, StatsRules } from './rules.js'

const CACHE_MS = 60_000
const TOP_STUCK = 20

const HISTORY = `${BASE}, local as (
  select b.*, (b.at at time zone $3::text)::date as day from base b
), firsts as (
  select day, project, count(*) as sessions
  from (select distinct on (session_id, project) session_id, project, day from local order by session_id, project, at) f
  group by day, project
)
select to_char(l.day, 'YYYY-MM-DD') as day, l.project, coalesce(sum(l.cost), 0) as cost, sum(sv.share) as limit_share,
  coalesce(max(f.sessions), 0) as sessions
from local l
left join seven sv on sv.message_id = l.message_id
left join firsts f on f.day = l.day and f.project = l.project
group by l.day, l.project
order by l.day, l.project`

const ACCOUNTS = `select distinct account from messages order by account`

const FOLDERS = `
select lower(regexp_replace(replace(project_dir, '\\', '/'), '^[a-zA-Z]:', '')) as dir, min(project_dir) as raw
from messages
where project_dir is not null
group by 1`

// $8 first day, $9 last day, both local and inclusive; $10 project labels or null for all.
// The previous period is as long and ends the day before $8.
const PERIOD = `${BASE}, bounds as (
  select ($8::date)::timestamp at time zone $3::text as lo,
    ($9::date + 1)::timestamp at time zone $3::text as hi,
    ($8::date - ($9::date - $8::date + 1))::timestamp at time zone $3::text as prev
), ranged as (
  select b.*, b.at >= bounds.lo as cur
  from base b, bounds
  where b.at >= bounds.prev and b.at < bounds.hi and ($10::text[] is null or b.project = any($10::text[]))
)`

const TOTALS = `${PERIOD}
select r.cur, coalesce(sum(r.cost), 0) as cost, count(*) as messages, count(distinct r.session_id) as sessions,
  count(distinct r.task) as tasks, count(*) filter (where r.cost is null) as unpriced, sum(sv.share) as limit_share,
  coalesce(sum(r.cost) filter (where exists (
    select 1 from spans sp
    where sp.session_id = r.session_id and sp.agent_id = r.agent_id and r.at between sp.from_at and sp.to_at
  )), 0) as stuck_cost
from ranged r
left join seven sv on sv.message_id = r.message_id
group by r.cur`

const MODELS = `${PERIOD}
select coalesce(substring(r.model from '^claude-([a-z]+)'), 'other') as key, coalesce(sum(r.cost), 0) as cost
from ranged r
where r.cur
group by 1
order by cost desc`

const ENTRYPOINTS = `${PERIOD}
select case
    when r.launch_reason is not null then 'baton'
    when r.entrypoint = 'claude-vscode' then 'vscode'
    when r.entrypoint = 'claude-desktop' then 'desktop'
    when r.entrypoint in ('cli', 'sdk-cli') then 'cli'
    else coalesce(r.entrypoint, 'other')
  end as key,
  coalesce(sum(r.cost), 0) as cost
from ranged r
where r.cur
group by 1
order by cost desc`

const TASKS = `${PERIOD}, cur as (
  select * from ranged where cur and task is not null
), stuck as (
  select t.task, count(distinct sp.id) as spans
  from stuck_spans sp
  join (select distinct session_id, task from cur) t on t.session_id = sp.session_id
  cross join bounds
  where sp.to_at >= bounds.lo and sp.from_at < bounds.hi
  group by t.task
)
select c.task, min(c.project) as project, t.title, t.status, coalesce(sum(c.cost), 0) as cost, sum(sv.share) as limit_share,
  count(distinct c.session_id) as sessions,
  count(distinct c.session_id) filter (where c.launch_reason = 'relay') as relays,
  count(distinct c.session_id) filter (where c.launch_reason = 'checkpoint') as checkpoints,
  count(distinct c.session_id) filter (where c.launch_reason = 'restart') as restarts,
  coalesce(max(st.spans), 0) as spans,
  coalesce('Переделка' = any(t.labels), false) as rework
from cur c
left join seven sv on sv.message_id = c.message_id
left join tasks t on t.task = c.task
left join stuck st on st.task = c.task
group by c.task, t.title, t.status, t.labels
order by cost desc, c.task`

const PICKED = `${PERIOD}, sess as (
  select session_id, min(project) as project from ranged where cur group by session_id
), picked as (
  select sp.*, sess.project
  from stuck_spans sp
  join sess on sess.session_id = sp.session_id
  cross join bounds
  where sp.to_at >= bounds.lo and sp.to_at < bounds.hi
)`

const WEEKS = `${PICKED}
select to_char(date_trunc('week', p.to_at at time zone $3::text), 'YYYY-MM-DD') as week, p.reason, count(*) as spans
from picked p
group by 1, 2
order by 1, 2`

const STUCK = `${PICKED}
select p.id, p.task, p.project, p.session_id, p.from_at, p.to_at, p.kinds, p.reason, p.note
from picked p
order by p.to_at desc
limit ${TOP_STUCK}`

const TASK_SESSIONS = `
select c.session_id, coalesce(s.custom_title, s.ai_title) as title, s.launch_reason, mode() within group (order by c.model) as model,
  min(c.at) as first_at, max(c.at) as last_at, coalesce(sum(c.cost), 0) as cost
from message_costs c
left join sessions s on s.session_id = c.session_id
where c.task = $1::text
group by c.session_id, s.custom_title, s.ai_title, s.launch_reason
order by first_at`

const TASK_SPANS = `
select sp.id, sp.task, null as project, sp.session_id, sp.from_at, sp.to_at, sp.kinds, sp.reason, sp.note
from stuck_spans sp
where sp.session_id in (select session_id from message_costs where task = $1::text)
order by sp.from_at`

type Row = Record<string, unknown>

interface Folders {
  dirs: string[]
  labels: string[]
}

const number = (value: unknown): number => Number(value ?? 0)
const maybe = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value))
const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value))
const iso = (value: unknown): string => (value instanceof Date ? value.toISOString() : String(value))
const round = (value: number, digits: number): number => Number(value.toFixed(digits))

export function mapHistory(rows: Row[], accounts: Row[], baton: string[], at: Date): StatsHistory {
  const days: string[] = []
  const totals = new Map<string, number>()
  for (const row of rows) {
    if (days.at(-1) !== row.day) days.push(String(row.day))
    const project = String(row.project)
    totals.set(project, (totals.get(project) ?? 0) + number(row.cost))
  }
  const projects = [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([project]) => project)
  const dayIndex = new Map(days.map((day, index) => [day, index]))
  const projectIndex = new Map(projects.map((project, index) => [project, index]))
  const cells: StatsCell[] = rows.map((row) => [
    dayIndex.get(String(row.day))!,
    projectIndex.get(String(row.project))!,
    round(number(row.cost), 4),
    number(row.sessions),
    round(number(row.limit_share), 3),
  ])
  return { at: at.toISOString(), accounts: accounts.map((row) => String(row.account)), baton, projects, days, cells }
}

function totals(row: Row | undefined): StatsTotals {
  return {
    cost: number(row?.cost),
    messages: number(row?.messages),
    sessions: number(row?.sessions),
    tasks: number(row?.tasks),
    unpriced: number(row?.unpriced),
    limit: maybe(row?.limit_share),
    stuckCost: number(row?.stuck_cost),
  }
}

function stuck(row: Row): StatsStuck {
  return {
    id: String(row.id),
    task: text(row.task),
    project: text(row.project),
    sessionId: String(row.session_id),
    fromAt: iso(row.from_at),
    toAt: iso(row.to_at),
    kinds: (row.kinds as string[] | null) ?? [],
    reason: text(row.reason),
    note: text(row.note),
  }
}

export interface PeriodRows {
  totals: Row[]
  models: Row[]
  entrypoints: Row[]
  tasks: Row[]
  weeks: Row[]
  stuck: Row[]
}

export function mapPeriod(query: PeriodQuery, rows: PeriodRows, at: Date): StatsPeriod {
  const share = (row: Row) => ({ key: String(row.key), cost: number(row.cost) })
  return {
    query,
    at: at.toISOString(),
    current: totals(rows.totals.find((row) => row.cur === true)),
    previous: totals(rows.totals.find((row) => row.cur === false)),
    models: rows.models.map(share),
    entrypoints: rows.entrypoints.map(share),
    tasks: rows.tasks.map((row) => ({
      task: String(row.task),
      project: String(row.project),
      title: text(row.title),
      status: text(row.status),
      cost: number(row.cost),
      limit: maybe(row.limit_share),
      sessions: number(row.sessions),
      relays: number(row.relays),
      checkpoints: number(row.checkpoints),
      restarts: number(row.restarts),
      spans: number(row.spans),
      rework: row.rework === true,
    })),
    weeks: rows.weeks.map((row) => ({ week: String(row.week), reason: text(row.reason), spans: number(row.spans) })),
    stuck: rows.stuck.map(stuck),
  }
}

export function mapTask(task: string, sessions: Row[], spans: Row[]): StatsTaskDetail {
  return {
    task,
    sessions: sessions.map((row) => ({
      sessionId: String(row.session_id),
      title: text(row.title),
      reason: text(row.launch_reason),
      model: text(row.model),
      firstAt: iso(row.first_at),
      lastAt: iso(row.last_at),
      cost: number(row.cost),
    })),
    spans: spans.map(stuck),
  }
}

export class StatsReader {
  private readonly pool: pg.Pool | null
  private readonly cache = new Map<string, { at: number; answer: StatsAnswer<unknown> }>()
  private readonly keys: string[]
  private readonly dirs: string[]
  private folders: { at: number; groups: Promise<Folders> } | null = null

  constructor(
    private readonly settings: ReaderSettings | string,
    projects: Record<string, string>,
    private readonly compareSettings: () => CompareSettings,
  ) {
    this.pool =
      typeof settings === 'string'
        ? null
        : new pg.Pool({ ...settings, max: 4, connectionTimeoutMillis: 5_000, statement_timeout: 20_000, idleTimeoutMillis: 60_000 })
    this.pool?.on('error', () => {})
    this.keys = Object.keys(projects)
    this.dirs = this.keys.map((key) => repoTail(projects[key]!))
  }

  history(filter: StatsFilter): Promise<StatsAnswer<StatsHistory>> {
    return this.cached(`history|${filter.scope}|${filter.account}|${filter.tz}`, async (pool) => {
      const [rows, accounts] = await Promise.all([this.query(pool, HISTORY, filter), pool.query<Row>(ACCOUNTS).then((result) => result.rows)])
      return mapHistory(rows, accounts, this.keys, new Date())
    })
  }

  period(query: PeriodQuery): Promise<StatsAnswer<StatsPeriod>> {
    const key = `period|${query.scope}|${query.account}|${query.tz}|${query.from}|${query.to}|${query.projects?.join(',') ?? '*'}`
    return this.cached(key, async (pool) => {
      const extra = [query.from, query.to, query.projects]
      const [totals, models, entrypoints, tasks, weeks, stuck] = await Promise.all(
        [TOTALS, MODELS, ENTRYPOINTS, TASKS, WEEKS, STUCK].map((sql) => this.query(pool, sql, query, extra)),
      )
      return mapPeriod(query, { totals: totals!, models: models!, entrypoints: entrypoints!, tasks: tasks!, weeks: weeks!, stuck: stuck! }, new Date())
    })
  }

  task(task: string): Promise<StatsAnswer<StatsTaskDetail>> {
    return this.cached(`task|${task}`, async (pool) => {
      const [sessions, spans] = await Promise.all([TASK_SESSIONS, TASK_SPANS].map((sql) => pool.query<Row>(sql, [task]).then((result) => result.rows)))
      return mapTask(task, sessions!, spans!)
    })
  }

  rules(query: RulesQuery): Promise<StatsAnswer<StatsRules>> {
    const settings = this.compareSettings()
    const key = `rules|${query.scope}|${query.account}|${query.projects?.join(',') ?? '*'}|${query.kinds?.join(',') ?? '*'}|${settings.minSessions}`
    return this.cached(key, (pool) => readRules(this.db(pool), query, settings))
  }

  ruleDiff(ids: string[]): Promise<StatsAnswer<RuleDiffFile[]>> {
    return this.cached(`diff|${ids.join(',')}`, (pool) => readRuleDiff(this.db(pool), ids))
  }

  compare(query: CompareQuery): Promise<StatsAnswer<StatsCompare>> {
    const settings = this.compareSettings()
    const key = `compare|${query.scope}|${query.account}|${query.projects?.join(',') ?? '*'}|${query.before}|${query.after}|${query.days}|${JSON.stringify(settings)}`
    return this.cached(key, (pool) => readCompare(this.db(pool), query, settings))
  }

  private db(pool: pg.Pool): RulesDb {
    return {
      base: (sql, filter, extra) => this.query(pool, sql, filter, extra),
      plain: (sql, params) => pool.query<Row>(sql, params).then((result) => result.rows),
      places: async () => {
        const { dirs, labels } = await this.groups(pool)
        return {
          baton: this.keys.map((key, index) => ({ key, dir: this.dirs[index]! })),
          folders: dirs.map((dir, index) => ({ dir, label: labels[index]! })),
        }
      },
    }
  }

  private async query(pool: pg.Pool, sql: string, filter: StatsFilter, extra: unknown[] = []): Promise<Row[]> {
    const { dirs, labels } = await this.groups(pool)
    const result = await pool.query<Row>(sql, [this.keys, this.dirs, filter.tz, filter.scope, filter.account, dirs, labels, ...extra])
    return result.rows
  }

  private groups(pool: pg.Pool): Promise<Folders> {
    if (this.folders !== null && Date.now() - this.folders.at < CACHE_MS) return this.folders.groups
    const groups = pool.query<{ dir: string; raw: string }>(FOLDERS).then((result) => {
      const found = folderGroups(result.rows, this.dirs)
      return { dirs: [...found.keys()], labels: [...found.values()] }
    })
    this.folders = { at: Date.now(), groups }
    groups.catch(() => (this.folders = null))
    return groups
  }

  private async cached<T>(key: string, read: (pool: pg.Pool) => Promise<T>): Promise<StatsAnswer<T>> {
    if (this.pool === null) return { state: 'off', reason: `не заданы ${this.settings as string} в .env` }
    const now = Date.now()
    for (const [each, entry] of this.cache) if (now - entry.at >= CACHE_MS) this.cache.delete(each)
    const hit = this.cache.get(key)
    if (hit !== undefined) return hit.answer as StatsAnswer<T>
    let answer: StatsAnswer<T>
    try {
      answer = { state: 'ok', data: await read(this.pool) }
    } catch (error) {
      answer = { state: 'error', error: error instanceof Error ? error.message : String(error) }
    }
    this.cache.set(key, { at: Date.now(), answer })
    return answer
  }
}
