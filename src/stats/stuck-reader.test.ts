import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { migrate, pgliteDb, STEPS } from '../../tally/src/migrations.js'
import { parseConfig } from '../config.js'
import type { StatsAnswer } from './model.js'
import { StatsReader } from './reader.js'
import { readCompareSides, type RulesDb } from './rules-reader.js'

const proxy = vi.hoisted(() => ({ query: null as null | ((sql: string, params?: unknown[]) => Promise<unknown>) }))
vi.mock('pg', () => ({ default: { Pool: class {
  on() {}
  end() { return Promise.resolve() }
  query(sql: string, params?: unknown[]) { return proxy.query!(sql, params) }
} } }))

let db: PGlite
let columns: unknown[]
const settings = { host: 'localhost', port: 1, database: 'tally', user: 'reader', password: 'fake' }
const config = parseConfig({ projects: [] }).stats
const reader = () => new StatsReader(settings, () => ({ ABC: 'C:/example' }), () => config)
const query = { scope: 'all' as const, account: null, tz: 'UTC', from: '2026-11-03', to: '2026-11-03', projects: null }
const data = <T,>(answer: StatsAnswer<T>): T => {
  if (answer.state !== 'ok') throw new Error(JSON.stringify(answer))
  return answer.data
}
const auditColumns = `select table_name, column_name, data_type, ordinal_position from information_schema.columns
  where table_name in ('audit_sessions', 'audit_tasks', 'task_repeats') order by table_name, ordinal_position`

beforeAll(async () => {
  db = await PGlite.create()
  await db.exec(`set timezone = 'UTC'`)
  await migrate(pgliteDb(db), STEPS.slice(0, 12))
  columns = (await db.query(auditColumns)).rows
  await db.exec(`insert into model_prices (model, input, output, cache_read, cache_write_5m, cache_write_1h)
    values ('example', 1, 0, 0, 0, 0)`)
  for (const [session, day] of [['before', '2026-11-02'], ['after', '2026-11-03']]) {
    await db.query(`insert into sessions (session_id, account, launch_task, launch_reason, project_dir)
      values ($1, 'fake', 'ABC-1', 'launch', 'C:/example')`, [session])
    for (const [index, reason] of ['normal', 'debug_loop', null].entries()) {
      const id = `${session}-${index}`
      const at = `${day}T12:0${index}:00Z`
      await db.query(`insert into messages (message_id, session_id, account, model, at, input,
        cache_write_5m, cache_write_1h, cache_read, output)
        values ($1, $2, 'fake', 'example', $3, $4, 0, 0, 0, 0)`, [id, session, at, (index + 1) * 1_000_000])
      await db.query(`insert into spans (id, session_id, from_uuid, to_uuid, from_at, to_at, kinds)
        values ($1, $2, $1, $1, $3, $3, array['repeat'])`, [id, session, at])
      if (reason !== null) await db.query(`insert into span_reasons
        (span_id, session_id, from_at, to_at, kinds, reason, note, prompt_version)
        values ($1, $2, $3, $3, array['repeat'], $4, 'Example', 1)`, [id, session, at, reason])
    }
  }
  await migrate(pgliteDb(db))
  proxy.query = (sql, params) => db.query(sql, params)
}, 30_000)

afterAll(async () => { await db?.close() })

it('upgrades a populated v12 without changing audit columns and is repeatable', async () => {
  expect((await db.query(auditColumns)).rows).toEqual(columns)
  expect(await migrate(pgliteDb(db))).toEqual({ state: 'current', version: STEPS.length })
  expect((await db.query('select count(*) from span_reasons')).rows).toEqual([{ count: 4 }])
})

it('excludes normal from session and task audit money and both task counters', async () => {
  expect((await db.query('select cost::float, stuck_cost::float from audit_sessions order by session_id')).rows)
    .toEqual([{ cost: 6, stuck_cost: 5 }, { cost: 6, stuck_cost: 5 }])
  expect((await db.query('select cost::float, stuck_cost::float, spans from audit_tasks')).rows)
    .toEqual([{ cost: 12, stuck_cost: 10, spans: 4 }])
  expect((await db.query('select spans from task_repeats')).rows).toEqual([{ spans: 4 }])
  expect((await db.query('select reason from stuck_spans order by id')).rows.map(row => row.reason))
    .toEqual(['normal', 'debug_loop', null, 'normal', 'debug_loop', null])
})

it('filters current and previous overview money and task counts while keeping lists and weeks', async () => {
  const result = data(await reader().period(query))
  expect(result.current).toMatchObject({ cost: 6, stuckCost: 5 })
  expect(result.previous).toMatchObject({ cost: 6, stuckCost: 5 })
  expect(result.tasks).toHaveLength(1)
  expect(result.tasks[0]).toMatchObject({ task: 'ABC-1', spans: 2 })
  expect(result.stuck.map(span => span.reason).sort()).toEqual(['debug_loop', 'normal', null].sort())
  expect(result.weeks.reduce((sum, week) => sum + week.spans, 0)).toBe(3)
  expect(data(await reader().task('ABC-1')).spans).toHaveLength(6)
})

it('filters stuck spend on both sides of a rule comparison', async () => {
  const source = {
    base: async (sql: string, _filter: unknown, extra: unknown[]) =>
      (await db.query(sql, [['ABC'], ['/example'], 'UTC', 'all', null, [], [], ...extra])).rows,
  } as RulesDb
  const result = await readCompareSides(source, query, {
    before: { from: '2026-11-02T00:00:00Z', to: '2026-11-03T00:00:00Z' },
    after: { from: '2026-11-03T00:00:00Z', to: '2026-11-04T00:00:00Z' },
  })
  expect(result.before).toMatchObject({ cost: 6, stuckCost: 5 })
  expect(result.after).toMatchObject({ cost: 6, stuckCost: 5 })
})

it('uses current reasons including other, and zeroes money and counts when all are normal', async () => {
  await db.exec('begin')
  try {
    await db.exec(`update span_reasons set reason = 'other' where reason = 'normal'`)
    expect(data(await reader().period(query)).current.stuckCost).toBe(6)
    expect((await db.query('select spans, stuck_cost::float from audit_tasks')).rows).toEqual([{ spans: 6, stuck_cost: 12 }])
    await db.exec(`insert into span_reasons (span_id, session_id, from_at, to_at, kinds, reason, note, prompt_version)
      select id, session_id, from_at, to_at, kinds, 'normal', 'Example', 1 from spans
      on conflict (span_id) do update set reason = 'normal'`)
    const result = data(await reader().period(query))
    expect(result.current.stuckCost).toBe(0)
    expect(result.tasks[0]?.spans).toBe(0)
    expect(result.stuck).toHaveLength(3)
    expect((await db.query('select spans, stuck_cost::float from audit_tasks')).rows).toEqual([{ spans: 0, stuck_cost: 0 }])
    expect((await db.query('select spans from task_repeats')).rows).toEqual([{ spans: 0 }])
  } finally {
    await db.exec('rollback')
  }
})

it('counts unclassified spans with the classifier absent and keeps an empty period empty', async () => {
  await db.exec('begin')
  try {
    await db.exec('delete from span_reasons')
    expect(data(await reader().period(query)).current.stuckCost).toBe(6)
    expect((await db.query('select spans, stuck_cost::float from audit_tasks')).rows).toEqual([{ spans: 6, stuck_cost: 12 }])
    const empty = data(await reader().period({ ...query, from: '2027-01-01', to: '2027-01-01' }))
    expect(empty.current.stuckCost).toBe(0)
    expect(empty.tasks).toEqual([])
  } finally {
    await db.exec('rollback')
  }
})

it('matches each response to its own stream when main and subagent spans overlap', async () => {
  await db.exec('begin')
  try {
    await db.exec(`insert into messages (message_id, session_id, agent_id, account, model, at, input,
      cache_write_5m, cache_write_1h, cache_read, output) values
      ('sub-debug', 'after', 'sub', 'fake', 'example', '2026-11-03T12:00:00Z', 4000000, 0, 0, 0, 0),
      ('sub-normal', 'after', 'sub', 'fake', 'example', '2026-11-03T12:01:00Z', 5000000, 0, 0, 0, 0);
      insert into spans (id, session_id, agent_id, from_uuid, to_uuid, from_at, to_at, kinds)
        select message_id, session_id, agent_id, message_id, message_id, at, at, array['repeat']
        from messages where agent_id = 'sub';
      insert into span_reasons (span_id, session_id, agent_id, from_at, to_at, kinds, reason, note, prompt_version)
        select id, session_id, agent_id, from_at, to_at, kinds,
          case when id = 'sub-normal' then 'normal' else 'debug_loop' end, 'Example', 1
        from spans where agent_id = 'sub'`)
    expect((await db.query(`select cost::float, stuck_cost::float from audit_sessions where session_id = 'after'`)).rows)
      .toEqual([{ cost: 15, stuck_cost: 9 }])
    const result = data(await reader().period(query))
    expect(result.current).toMatchObject({ cost: 15, stuckCost: 9 })
    expect(result.tasks[0]?.spans).toBe(3)
  } finally {
    await db.exec('rollback')
  }
})
