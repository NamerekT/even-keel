import pg from 'pg'
import type {
  LimitCoverage,
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
import { BASE, familyOf } from './base-sql.js'
import { mapCalibration, type Calibration } from './calibration.js'
import { checkpointThreshold, type CheckpointMeasure, type CheckpointThreshold } from './checkpoint.js'
import { folderGroups, repoTail } from './model.js'
import { readCompare, readRuleDiff, readRules, type RulesDb } from './rules-reader.js'
import { readSteps, readTaskSteps } from './steps-reader.js'
import { TALLY_SCHEMA_VERSION, tallyVersion } from './tally-schema.js'
import type { StatsSteps, StatsTaskStep } from './steps.js'
import type { StatsConfig } from '../state.js'
import type { CompareQuery, CompareSettings, RuleDiffFile, RulesQuery, StatsCompare, StatsRules } from './rules.js'

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

// $1 time zone: the spend since local midnight, per account folder key.
const SPEND = `
select account, coalesce(sum(cost), 0) as cost
from message_costs
where at >= (now() at time zone $1::text)::date::timestamp at time zone $1::text
group by account`

// $1 time zone, $2 account or null.
const COVERAGE = `
select to_char(min(observed_at) at time zone $1::text, 'YYYY-MM-DD') as from_day,
  to_char(max(observed_at) at time zone $1::text, 'YYYY-MM-DD') as to_day
from limit_snapshots
where span = '7d' and ($2::text is null or account = $2::text)`

// $1 time zone, $2 account or null, $3 first and $4 last local day of the period.
const WINDOWS = `
select account, resets_at, peak, resets_at > now() as open
from limit_windows
where span = '7d' and ($2::text is null or account = $2::text)
  and starts_at < ($4::date + 1)::timestamp at time zone $1::text
  and resets_at > ($3::date)::timestamp at time zone $1::text
order by account, resets_at`

const FOLDERS = `
select lower(regexp_replace(replace(project_dir, '\\', '/'), '^[a-zA-Z]:', '')) as dir, min(project_dir) as raw,
  coalesce(sum(cost), 0) as cost
from message_costs
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
select coalesce(${familyOf('r.model')}, 'other') as key, coalesce(sum(r.cost), 0) as cost
from ranged r
where r.cur
group by 1
order by cost desc`

const ENTRYPOINTS = `${PERIOD}
select case
    when r.launch_reason is not null then 'chain'
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
  coalesce('Переделка' = any(t.labels), false) as rework,
  t.estimate_h, tt.active_s, tt.wait_s, tt.total_s, t.done, t.component,
  mode() within group (order by ${familyOf('c.model')}) as model
from cur c
left join seven sv on sv.message_id = c.message_id
left join tasks t on t.task = c.task
left join task_times tt on tt.task = c.task
left join stuck st on st.task = c.task
group by c.task, t.title, t.status, t.labels, t.estimate_h, t.done, t.component, tt.active_s, tt.wait_s, tt.total_s
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
  min(c.at) as first_at, max(c.at) as last_at, coalesce(sum(c.cost), 0) as cost, mode() within group (order by c.account) as account
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

const CALIBRATION = `
select task, title, component, estimate_h, active_min
from task_estimates
where key = $1::text and done and active_min is not null
order by last_at desc`

const TASK_COMPONENT = `select component from tasks where task = $1::text`

// $1 project keys. Requests are those of the main thread, numbered within the session; a successor is a
// session started from a checkpoint note. The note is whatever a session spent from writing it to its end,
// the recovery is what a successor spent before its first edit.
const CHECKPOINT = `
with own as (
  select s.session_id, coalesce(s.launch_reason = 'checkpoint', false) as handed, split_part(st.task, '-', 1) as key
  from sessions s
  join session_tasks st on st.session_id = s.session_id
  where split_part(st.task, '-', 1) = any($1::text[])
), reqs as (
  select c.session_id, c.message_id, c.cost, c.model,
    c.input + c.cache_write_5m + c.cache_write_1h + c.cache_read as ctx,
    row_number() over (partition by c.session_id order by c.at, c.message_id) as n
  from message_costs c
  join own o on o.session_id = c.session_id
  where c.agent_id is null and c.entrypoint is distinct from 'tally-classify'
), marks as (
  select r.session_id,
    min(r.n) filter (where t.brief not like '%.temp/handoff.md') as edit_n,
    min(r.n) filter (where t.brief like '%.temp/handoff.md') as note_n
  from tool_calls t
  join reqs r on r.message_id = t.message_id
  where t.name in ('Edit', 'Write', 'MultiEdit', 'NotebookEdit')
  group by r.session_id
), per as (
  select o.session_id, o.key, o.handed,
    max(r.ctx) as peak,
    max(r.ctx) filter (where r.n = 15) as ctx15,
    sum(r.cost) filter (where r.n < m.edit_n) as recovery,
    sum(r.cost) filter (where r.n >= m.note_n) as note,
    (array_agg(r.model order by r.n))[1] as model
  from own o
  join reqs r on r.session_id = o.session_id
  left join marks m on m.session_id = o.session_id
  group by o.session_id, o.key, o.handed
), total as (
  select key,
    count(*) filter (where handed) as handoffs,
    count(*) filter (where peak > 150000) as sessions,
    percentile_cont(0.5) within group (order by ctx15) filter (where handed) as base,
    percentile_cont(0.5) within group (order by recovery) filter (where handed) as recovery,
    percentile_cont(0.5) within group (order by note) as note,
    mode() within group (order by model) filter (where handed) as model
  from per
  group by key
)
select t.key, t.handoffs, t.sessions, t.base, t.recovery, t.note, (
  select p.cache_read from model_prices p
  where starts_with(t.model, p.model) order by length(p.model) desc limit 1
) as cache_read
from total t`

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

function coverage(rows: Row[]): LimitCoverage | null {
  const row = rows[0]
  if (row?.from_day == null || row.to_day == null) return null
  return { from: String(row.from_day), to: String(row.to_day) }
}

export function mapHistory(rows: Row[], accounts: Row[], limits: Row[], tracked: string[], at: Date): StatsHistory {
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
  return { at: at.toISOString(), accounts: accounts.map((row) => String(row.account)), tracked, projects, days, cells, limits: coverage(limits) }
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
  coverage: Row[]
  windows: Row[]
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
    limits: coverage(rows.coverage),
    windows: rows.windows.map((row) => ({ account: String(row.account), resetsAt: iso(row.resets_at), peak: number(row.peak), open: row.open === true })),
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
      estimateH: maybe(row.estimate_h),
      activeS: maybe(row.active_s),
      waitS: maybe(row.wait_s),
      totalS: maybe(row.total_s),
      done: typeof row.done === 'boolean' ? row.done : null,
      component: text(row.component),
      model: text(row.model),
    })),
    weeks: rows.weeks.map((row) => ({ week: String(row.week), reason: text(row.reason), spans: number(row.spans) })),
    stuck: rows.stuck.map(stuck),
  }
}

export function mapTask(task: string, sessions: Row[], spans: Row[], steps: StatsTaskStep[] = []): StatsTaskDetail {
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
      account: text(row.account),
    })),
    spans: spans.map(stuck),
    steps,
  }
}

export function rulesKey(query: RulesQuery, settings: CompareSettings): string {
  return `rules|${JSON.stringify(query)}|${settings.minSessions}`
}

export class StatsReader {
  // A string is why the stats are off (`TALLY_DISABLED`, `TALLY_UNCHOSEN` or the missing variables); the local database
  // comes as a promise that settles once it is open.
  private pool!: Promise<pg.Pool | string>
  private readonly cache = new Map<string, { at: number; answer: StatsAnswer<unknown> }>()
  private folders: { at: number; key: string; groups: Promise<Folders> } | null = null

  constructor(
    settings: ReaderSettings | string | Promise<ReaderSettings>,
    private readonly projects: () => Record<string, string>,
    private readonly statsConfig: () => StatsConfig,
  ) {
    this.setReader(settings)
  }

  /** The database moved (`TALLY_*` or the mode changed): the old pool ends, the answers read from it go. */
  setReader(settings: ReaderSettings | string | Promise<ReaderSettings>): void {
    const before = this.pool
    this.pool = Promise.resolve(settings).then((each) => {
      if (typeof each === 'string') return each
      const pool = new pg.Pool({ ...each, max: 4, connectionTimeoutMillis: 5_000, statement_timeout: 20_000, idleTimeoutMillis: 60_000 })
      pool.on('error', () => {})
      return pool
    })
    this.pool.catch(() => {})
    this.cache.clear()
    this.folders = null
    void before?.then((pool) => (typeof pool === 'string' ? undefined : pool.end())).catch(() => {})
  }

  private get keys(): string[] {
    return Object.keys(this.projects())
  }

  private get dirs(): string[] {
    const projects = this.projects()
    return Object.keys(projects).map((key) => repoTail(projects[key]!))
  }

  history(filter: StatsFilter): Promise<StatsAnswer<StatsHistory>> {
    return this.cached(`history|${filter.scope}|${filter.account}|${filter.tz}`, async (pool) => {
      const [rows, accounts, limits] = await Promise.all([
        this.query(pool, HISTORY, filter),
        pool.query<Row>(ACCOUNTS).then((result) => result.rows),
        pool.query<Row>(COVERAGE, [filter.tz, filter.account]).then((result) => result.rows),
      ])
      return mapHistory(rows, accounts, limits, this.keys, new Date())
    })
  }

  period(query: PeriodQuery): Promise<StatsAnswer<StatsPeriod>> {
    const key = `period|${query.scope}|${query.account}|${query.tz}|${query.from}|${query.to}|${query.projects?.join(',') ?? '*'}`
    return this.cached(key, async (pool) => {
      const extra = [query.from, query.to, query.projects]
      const plain = (sql: string, params: unknown[]) => pool.query<Row>(sql, params).then((result) => result.rows)
      const [[totals, models, entrypoints, tasks, weeks, stuck], coverage, windows] = await Promise.all([
        Promise.all([TOTALS, MODELS, ENTRYPOINTS, TASKS, WEEKS, STUCK].map((sql) => this.query(pool, sql, query, extra))),
        plain(COVERAGE, [query.tz, query.account]),
        plain(WINDOWS, [query.tz, query.account, query.from, query.to]),
      ])
      const rows = { totals: totals!, coverage, windows, models: models!, entrypoints: entrypoints!, tasks: tasks!, weeks: weeks!, stuck: stuck! }
      return mapPeriod(query, rows, new Date())
    })
  }

  task(task: string): Promise<StatsAnswer<StatsTaskDetail>> {
    return this.cached(`task|${task}`, async (pool) => {
      const [[sessions, spans], steps] = await Promise.all([
        Promise.all([TASK_SESSIONS, TASK_SPANS].map((sql) => pool.query<Row>(sql, [task]).then((result) => result.rows))),
        readTaskSteps(this.db(pool), task),
      ])
      return mapTask(task, sessions!, spans!, steps)
    })
  }

  /** Any project key Tally has seen, not only the tracked ones: the huly plugin runs in projects outside the chain. */
  calibration(project: string, task: string | null): Promise<StatsAnswer<Calibration>> {
    return this.cached(`calibration|${project}|${task ?? ''}`, async (pool) => {
      const [rows, owner] = await Promise.all([
        pool.query<Row>(CALIBRATION, [project]).then((result) => result.rows),
        task === null ? [] : pool.query<Row>(TASK_COMPONENT, [task]).then((result) => result.rows),
      ])
      const closed = rows.map((row) => ({
        task: String(row.task),
        title: text(row.title),
        component: text(row.component),
        estimateH: maybe(row.estimate_h),
        activeMin: number(row.active_min),
      }))
      return mapCalibration(project, text(owner[0]?.component), closed, this.statsConfig().compare.minTasks)
    })
  }

  /** The checkpoint threshold of every tracked project, for the page. */
  async checkpoints(): Promise<StatsAnswer<CheckpointThreshold[]>> {
    const answer = await this.checkpointMeasures()
    if (answer.state !== 'ok') return answer
    const pinned = this.statsConfig().checkpointTokens
    return { state: 'ok', data: this.keys.map((key) => checkpointThreshold(key, answer.data[key] ?? null, pinned)) }
  }

  /** For the hook, so it never fails: without statistics the project runs on the default or the pinned number. */
  async checkpoint(project: string): Promise<CheckpointThreshold> {
    const answer = await this.checkpointMeasures()
    const measure = answer.state === 'ok' ? (answer.data[project] ?? null) : null
    return checkpointThreshold(project, measure, this.statsConfig().checkpointTokens)
  }

  private checkpointMeasures(): Promise<StatsAnswer<Record<string, CheckpointMeasure>>> {
    return this.cached('checkpoint', async (pool) => {
      const { rows } = await pool.query<Row>(CHECKPOINT, [this.keys])
      return Object.fromEntries(
        rows.map((row): [string, CheckpointMeasure] => [
          String(row.key),
          {
            handoffs: number(row.handoffs),
            sessions: number(row.sessions),
            base: maybe(row.base),
            note: maybe(row.note),
            recovery: maybe(row.recovery),
            cacheRead: maybe(row.cache_read),
          },
        ]),
      )
    })
  }

  /** Today's spend in dollars by account folder key, for the accounts panel; an API account pays it from its key. */
  spend(tz: string): Promise<StatsAnswer<Record<string, number>>> {
    return this.cached(`spend|${tz}`, async (pool) => {
      const { rows } = await pool.query<Row>(SPEND, [tz])
      return Object.fromEntries(rows.map((row) => [String(row.account), number(row.cost)]))
    })
  }

  steps(query: PeriodQuery): Promise<StatsAnswer<StatsSteps>> {
    const key = `steps|${query.scope}|${query.account}|${query.tz}|${query.from}|${query.to}|${query.projects?.join(',') ?? '*'}`
    return this.cached(key, (pool) => readSteps(this.db(pool), query))
  }

  rules(query: RulesQuery): Promise<StatsAnswer<StatsRules>> {
    const settings = this.statsConfig().compare
    return this.cached(rulesKey(query, settings), (pool) => readRules(this.db(pool), query, settings))
  }

  ruleDiff(ids: string[]): Promise<StatsAnswer<RuleDiffFile[]>> {
    return this.cached(`diff|${ids.join(',')}`, (pool) => readRuleDiff(this.db(pool), ids))
  }

  compare(query: CompareQuery): Promise<StatsAnswer<StatsCompare>> {
    const settings = this.statsConfig().compare
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
          tracked: this.keys.map((key, index) => ({ key, dir: this.dirs[index]! })),
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
    const { moves, otherBelow } = this.statsConfig()
    const key = JSON.stringify([moves, otherBelow])
    if (this.folders !== null && this.folders.key === key && Date.now() - this.folders.at < CACHE_MS) return this.folders.groups
    const tracked = this.keys.map((each, index) => ({ key: each, dir: this.dirs[index]! }))
    const groups = pool.query<{ dir: string; raw: string; cost: string | number }>(FOLDERS).then((result) => {
      const folders = result.rows.map((row) => ({ dir: row.dir, raw: row.raw, cost: Number(row.cost) }))
      const found = folderGroups(folders, tracked, moves, otherBelow)
      return { dirs: [...found.keys()], labels: [...found.values()] }
    })
    this.folders = { at: Date.now(), key, groups }
    groups.catch(() => (this.folders = null))
    return groups
  }

  private async cached<T>(key: string, read: (pool: pg.Pool) => Promise<T>): Promise<StatsAnswer<T>> {
    const now = Date.now()
    for (const [each, entry] of this.cache) if (now - entry.at >= CACHE_MS) this.cache.delete(each)
    const hit = this.cache.get(key)
    if (hit !== undefined) return hit.answer as StatsAnswer<T>
    let answer: StatsAnswer<T>
    try {
      const pool = await this.pool
      if (typeof pool === 'string') return { state: 'off', reason: pool }
      const version = await tallyVersion(pool)
      answer = version > TALLY_SCHEMA_VERSION ? { state: 'newer', version, known: TALLY_SCHEMA_VERSION } : { state: 'ok', data: await read(pool) }
    } catch (error) {
      answer = { state: 'error', error: error instanceof Error ? error.message : String(error) }
    }
    this.cache.set(key, { at: Date.now(), answer })
    return answer
  }
}
