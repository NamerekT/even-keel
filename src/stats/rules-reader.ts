import type { StatsFilter } from './model.js'
import { BASE } from './base-sql.js'
import { filterSets, withImports, type ImportFile, type ImportPrecision, type RuleImport, type RulePurpose } from './rule-imports.js'
import {
  compareOf,
  type CompareSettings,
  mergeMarks,
  netHashes,
  ruleDiff,
  ruleSets,
  scopeProject,
  withNetLines,
  type CompareQuery,
  type RuleChangeRow,
  type RuleDiffFile,
  type RuleEditRow,
  type RuleKind,
  type RulesQuery,
  type ScopePlaces,
  type SideSums,
  type StatsCompare,
  type StatsRules,
} from './rules.js'

type Row = Record<string, unknown>

export interface RulesDb {
  base(sql: string, filter: StatsFilter, extra: unknown[]): Promise<Row[]>
  plain(sql: string, params: unknown[]): Promise<Row[]>
  places(): Promise<ScopePlaces>
}

const CHANGES = `
select c.id, c.key, c.at, c.added, c.removed, c.old_hash, c.new_hash, f.display, f.kind, f.scope
from rule_changes c
join rule_files f on f.key = c.key
order by c.at`

// Only edits whose tool call did not fail. A shell command writing several files has ids '<tool use id>:<n>' past the first.
const EDITS = `
select e.session_id, e.key, e.at, e.added, e.removed, f.display, f.kind, f.scope
from rule_edits e
join rule_files f on f.key = e.key
left join tool_calls t on t.tool_use_id = split_part(e.tool_use_id, ':', 1)
where e.session_id is not null and e.at is not null and t.is_error is not true
order by e.at`

const SESSION_INFO = `
select st.session_id, st.task, coalesce(s.custom_title, s.ai_title) as title
from session_tasks st
join sessions s on s.session_id = st.session_id
where st.session_id = any($1::text[])`

// Each answer of Tally's classifier is a session of one message with a ~1k context: not a Claude Code session,
// and no rule edit changes it. Counted, it drowned the session median of the entry context (BTN-52).
const SESSIONS_ONLY = `entrypoint is distinct from 'tally-classify'`

// $8 project labels or null for all. Days do not matter here, $3 is cast only so Postgres knows its type.
const STARTS = `${BASE}
select extract(epoch from min(at)) * 1000 as started
from base
where ($8::text[] is null or project = any($8::text[])) and $3::text is not null and ${SESSIONS_ONLY}
group by session_id
order by 1`

const DIFF_CHANGES = `
select c.key, c.at, c.old_hash, c.new_hash, f.display, f.kind
from rule_changes c
join rule_files f on f.key = c.key
where c.id = any($1::text[])`

const TEXTS = `select hash, content from rule_texts where hash = any($1::text[])`

// $8 project labels or null, $9–$12 the bounds of the before side and of the after side.
// A session takes the side of its first message, a task the side of its first message too. $3 as in STARTS.
const SIDED = `${BASE}, picked as (
  select * from base where ($8::text[] is null or project = any($8::text[])) and $3::text is not null and ${SESSIONS_ONLY}
), sides as (
  select $9::timestamptz as b_lo, $10::timestamptz as b_hi, $11::timestamptz as a_lo, $12::timestamptz as a_hi
), firsts as (
  select session_id, min(at) as first_at from picked group by session_id
), sided as (
  select f.session_id, case
      when f.first_at >= s.b_lo and f.first_at < s.b_hi then 'before'
      when f.first_at >= s.a_lo and f.first_at < s.a_hi then 'after'
    end as side
  from firsts f, sides s
)`

const SIDE_SESSIONS = `${SIDED}
select x.side, count(distinct x.session_id) as sessions, coalesce(sum(p.cost), 0) as cost,
  coalesce(sum(p.cost) filter (where exists (
    select 1 from spans sp
    where sp.session_id = p.session_id and sp.agent_id = p.agent_id and p.at between sp.from_at and sp.to_at
  )), 0) as stuck_cost
from sided x
join picked p on p.session_id = x.session_id
where x.side is not null
group by x.side`

const SIDE_ENTRY = `${SIDED}
select x.side, percentile_cont(0.5) within group (order by e.tokens) as entry
from sided x
cross join lateral (
  select m.input + m.cache_write_5m + m.cache_write_1h + m.cache_read as tokens
  from messages m
  where m.session_id = x.session_id and m.agent_id is null
  order by m.at
  limit 1
) e
where x.side is not null
group by x.side`

// Main-thread API messages of the side's sessions.
const SIDE_REQUESTS = `${SIDED}
select x.side, count(*) as requests, coalesce(sum(r.tokens), 0) as context_tokens,
  count(*) filter (where r.tokens > 150000) as over150, coalesce(sum(p.cost), 0) as request_cost
from sided x
join picked p on p.session_id = x.session_id and p.agent_id = ''
join messages m on m.message_id = p.message_id
cross join lateral (select m.input + m.cache_write_5m + m.cache_write_1h + m.cache_read as tokens) r
where x.side is not null
group by x.side`

const SIDE_MODELS = `${SIDED}
select x.side, p.model, count(*) as requests
from sided x
join picked p on p.session_id = x.session_id and p.agent_id = ''
where x.side is not null and p.model is not null
group by x.side, p.model`

const SIDE_TOOLS = `${SIDED}
select x.side, count(*) as calls,
  count(*) filter (where t.is_error and coalesce(t.error_kind, '') not in ('denied', 'hook')) as errors,
  count(*) filter (where t.error_kind in ('denied', 'hook')) as denied
from sided x
join tool_calls t on t.session_id = x.session_id
where x.side is not null
group by x.side`

const SIDE_TASKS = `${SIDED}, tasks as (
  select task, min(at) as first_at, coalesce(sum(cost), 0) as cost, count(distinct session_id) as sessions
  from picked
  where task is not null
  group by task
), tasked as (
  select t.*, case
      when t.first_at >= s.b_lo and t.first_at < s.b_hi then 'before'
      when t.first_at >= s.a_lo and t.first_at < s.a_hi then 'after'
    end as side
  from tasks t, sides s
)
select side, count(*) as tasks, percentile_cont(0.5) within group (order by cost) as task_cost, avg(sessions) as sessions_per_task
from tasked
where side is not null
group by side`

// Tasks as the session audit sees them (view task_estimates, BTN-75): a session gives all its spend to its task,
// the side is that of the task's first session. Only tasks with a message under the filters of the page.
// The family is model_family of the view in one pass: the view's own subquery reads audit_sessions once per task.
const SIDE_FAMILIES = `${SIDED}, own as (
  select distinct task from picked where task is not null
), families as (
  select task, mode() within group (order by substring(model from '(opus|sonnet|haiku)')) as family
  from audit_sessions
  where task is not null
  group by task
)
select x.side, f.family, count(*) as tasks, count(*) filter (where e.done) as closed,
  coalesce(sum(e.cost), 0) as cost,
  percentile_cont(0.5) within group (order by e.cost) filter (where e.done) as closed_cost,
  percentile_cont(0.5) within group (order by e.active_min) filter (where e.done) as closed_minutes,
  count(e.fact_ratio) filter (where e.done) as estimated,
  percentile_cont(0.5) within group (order by e.fact_ratio) filter (where e.done) as ratio
from task_estimates e
join own o on o.task = e.task
left join families f on f.task = e.task
cross join sides s
cross join lateral (
  select case
      when e.first_at >= s.b_lo and e.first_at < s.b_hi then 'before'
      when e.first_at >= s.a_lo and e.first_at < s.a_hi then 'after'
    end as side
) x
where x.side is not null
group by x.side, f.family`

const IMPORTS = `select id, at, until, precision, sessions, files, purpose, reason, task, source from rule_imports order by at`

const iso = (value: unknown): string => (value instanceof Date ? value.toISOString() : String(value))
const maybe = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value))

const importOf = (row: Row): RuleImport => ({
  id: String(row.id),
  at: iso(row.at),
  until: row.until === null ? null : iso(row.until),
  precision: String(row.precision) as ImportPrecision,
  sessions: row.sessions as string[],
  files: row.files as ImportFile[],
  purpose: row.purpose as RulePurpose[],
  reason: String(row.reason),
  task: row.task === null ? null : String(row.task),
  source: String(row.source),
})

export async function readRules(db: RulesDb, query: RulesQuery, settings: CompareSettings): Promise<StatsRules> {
  const [changeRows, editRows, importRows, starts, places] = await Promise.all([
    db.plain(CHANGES, []),
    db.plain(EDITS, []),
    db.plain(IMPORTS, []),
    db.base(STARTS, query, [query.projects]),
    db.places(),
  ])
  const fileOf = (row: Row) => ({
    key: String(row.key),
    display: String(row.display),
    kind: String(row.kind) as RuleKind,
    project: scopeProject(String(row.scope), places),
    at: iso(row.at),
    added: Number(row.added),
  })
  const changes: RuleChangeRow[] = changeRows.map((row) => ({
    ...fileOf(row),
    id: String(row.id),
    removed: Number(row.removed),
    oldHash: row.old_hash === null ? null : String(row.old_hash),
    newHash: row.new_hash === null ? null : String(row.new_hash),
  }))
  const edits: RuleEditRow[] = editRows.map((row) => ({ ...fileOf(row), sessionId: String(row.session_id), removed: maybe(row.removed) }))
  const ids = [...new Set(edits.map((each) => each.sessionId))]
  const info = ids.length === 0 ? [] : await db.plain(SESSION_INFO, [ids])
  const sessions = new Map(info.map((row) => [String(row.session_id), { task: row.task === null ? null : String(row.task), title: row.title === null ? null : String(row.title) }]))
  const filtered = filterSets(withImports(ruleSets(changes, edits, sessions), importRows.map(importOf), places), query)
  const hashes = netHashes(filtered, changes)
  const texts = hashes.length === 0 ? [] : await db.plain(TEXTS, [hashes])
  const sets = withNetLines(filtered, changes, new Map(texts.map((row) => [String(row.hash), String(row.content)])))
  const marks = mergeMarks(sets, starts.map((row) => Number(row.started)), settings.minSessions)
  return { at: new Date().toISOString(), marks, compare: settings }
}

export async function readRuleDiff(db: RulesDb, ids: string[]): Promise<RuleDiffFile[]> {
  const rows = await db.plain(DIFF_CHANGES, [ids])
  const hashes = [...new Set(rows.flatMap((row) => [row.old_hash, row.new_hash]).filter((hash) => hash !== null))]
  const texts = hashes.length === 0 ? [] : await db.plain(TEXTS, [hashes])
  return ruleDiff(
    rows.map((row) => ({
      key: String(row.key),
      display: String(row.display),
      kind: String(row.kind) as RuleKind,
      at: iso(row.at),
      oldHash: row.old_hash === null ? null : String(row.old_hash),
      newHash: row.new_hash === null ? null : String(row.new_hash),
    })),
    new Map(texts.map((row) => [String(row.hash), String(row.content)])),
  )
}

export type CompareSides = Record<'before' | 'after', { from: string; to: string }>

export async function readCompare(db: RulesDb, query: CompareQuery, settings: CompareSettings): Promise<StatsCompare> {
  const days = query.days ?? settings.days
  const shift = (at: string, by: number) => new Date(Date.parse(at) + by * 86_400_000).toISOString()
  const sides = { before: { from: shift(query.before, -days), to: query.before }, after: { from: query.after, to: shift(query.after, days) } }
  return compareOf(sides, await readCompareSides(db, query, sides), { ...settings, days })
}

// Sums of two arbitrary periods; readCompare uses it.
export async function readCompareSides(db: RulesDb, filter: StatsFilter & { projects: string[] | null }, sides: CompareSides): Promise<Record<'before' | 'after', SideSums>> {
  const extra = [filter.projects, sides.before.from, sides.before.to, sides.after.from, sides.after.to]
  const [sessions, entry, tools, tasks, requests, models, families] = await Promise.all(
    [SIDE_SESSIONS, SIDE_ENTRY, SIDE_TOOLS, SIDE_TASKS, SIDE_REQUESTS, SIDE_MODELS, SIDE_FAMILIES].map((sql) => db.base(sql, filter, extra)),
  )
  const pick = (rows: Row[], side: string) => rows.find((row) => row.side === side) ?? {}
  const sums = (side: 'before' | 'after'): SideSums => {
    const s = pick(sessions!, side)
    const t = pick(tasks!, side)
    const tool = pick(tools!, side)
    const r = pick(requests!, side)
    return {
      tasks: Number(t.tasks ?? 0),
      sessions: Number(s.sessions ?? 0),
      taskCost: maybe(t.task_cost),
      sessionsPerTask: maybe(t.sessions_per_task),
      cost: Number(s.cost ?? 0),
      stuckCost: Number(s.stuck_cost ?? 0),
      calls: Number(tool.calls ?? 0),
      errors: Number(tool.errors ?? 0),
      denied: Number(tool.denied ?? 0),
      entryTokens: maybe(pick(entry!, side).entry),
      requests: Number(r.requests ?? 0),
      contextTokens: Number(r.context_tokens ?? 0),
      over150: Number(r.over150 ?? 0),
      requestCost: Number(r.request_cost ?? 0),
      models: models!.filter((row) => row.side === side).map((row) => ({ model: String(row.model), requests: Number(row.requests) })),
      families: families!
        .filter((row) => row.side === side)
        .map((row) => ({
          family: row.family === null ? null : String(row.family),
          tasks: Number(row.tasks),
          closed: Number(row.closed),
          cost: Number(row.cost),
          closedCost: maybe(row.closed_cost),
          closedMinutes: maybe(row.closed_minutes),
          estimated: Number(row.estimated),
          ratio: maybe(row.ratio),
        })),
    }
  }
  return { before: sums('before'), after: sums('after') }
}
