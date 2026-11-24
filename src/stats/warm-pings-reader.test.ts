import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { SESSION_FOLDERS } from '../../tally/src/db.js'
import { REFRESH_LIMIT_SHARES } from '../../tally/src/limit-shares-stored.js'
import { migrate, pgliteDb } from '../../tally/src/migrations.js'
import { parseConfig } from '../config.js'
import { StatsReader } from './reader.js'
import type { StatsAnswer } from './model.js'

// A task's cost on /stats with its keep-warm pings (BTN-1413): they add to the cost and the weekly limit's share, and
// their part is given apart.

const proxy = vi.hoisted(() => ({ query: null as null | ((sql: string, params?: unknown[]) => Promise<unknown>) }))
vi.mock('pg', () => ({ default: { Client: class {}, Pool: class {
  on() {}
  end() { return Promise.resolve() }
  query(sql: string, params?: unknown[]) { return proxy.query!(sql, params) }
} } }))

let db: PGlite
let reader: StatsReader
const query = { scope: 'all' as const, account: null, tz: 'UTC', from: '2026-11-01', to: '2026-11-07', projects: null }
const data = <T,>(answer: StatsAnswer<T>): T => {
  if (answer.state !== 'ok') throw new Error(JSON.stringify(answer))
  return answer.data
}

beforeAll(async () => {
  db = await PGlite.create()
  await migrate(pgliteDb(db))
  proxy.query = (sql, params) => db.query(sql, params)
  await db.exec(`insert into model_prices (model, input, output, cache_read, cache_write_5m, cache_write_1h) values ('claude-opus-5-5', 1, 1, 0.1, 1, 2)`)
  await db.exec(`insert into sessions (session_id, account, launch_task, launch_reason) values
    ('warm', 'a', 'ABC-1', 'launch'), ('cold', 'a', 'ABC-2', 'launch'), ('other', 'b', 'ABC-3', 'launch')`)
  await db.exec(`insert into messages (message_id, session_id, account, project_dir, task, at, model, input, cache_write_5m, cache_write_1h, cache_read, output) values
    ('m1', 'warm', 'a', 'C:/abc', 'ABC-1', '2026-11-03T12:00:00Z', 'claude-opus-5-5', 2000000, 0, 0, 0, 0),
    ('m2', 'cold', 'a', 'C:/abc', 'ABC-2', '2026-11-03T12:00:00Z', 'claude-opus-5-5', 1000000, 0, 0, 0, 0),
    ('m3', 'other', 'b', 'C:/abc', 'ABC-3', '2026-11-03T12:00:00Z', 'claude-opus-5-5', 1000000, 0, 0, 0, 0)`)
  // A ping in the period, one before it, and one of another account's session.
  await db.exec(`insert into warm_pings (session_id, at, machine, account, task, project_id, model, input, cache_write_5m, cache_write_1h, cache_read, output) values
    ('warm', '2026-11-03T12:30:00Z', '', 'a', 'ABC-1', null, 'claude-opus-5-5', 0, 0, 0, 10000000, 0),
    ('warm', '2026-10-20T12:30:00Z', '', 'a', 'ABC-1', null, 'claude-opus-5-5', 0, 0, 0, 10000000, 0),
    ('other', '2026-11-03T12:30:00Z', '', 'b', 'ABC-3', null, 'claude-opus-5-5', 0, 0, 0, 20000000, 0)`)
  // a, 7d: (10:00, 13:00] +3, shared by the responses (2 and 1) and the ping (1).
  await db.exec(`insert into limit_snapshots (account, span, observed_at, used_percentage, resets_at, source) values
    ('a', '7d', '2026-11-03T10:00:00Z', 10, '2026-11-08T10:00:00Z', 'statusline'),
    ('a', '7d', '2026-11-03T13:00:00Z', 13, '2026-11-08T10:00:00Z', 'statusline')`)
  await db.exec(SESSION_FOLDERS)
  await db.exec(REFRESH_LIMIT_SHARES)
  reader = new StatsReader({ host: 'localhost', port: 1, database: 'tally', user: 'reader', password: 'fake' },
    () => ({ ABC: 'C:/abc' }), () => parseConfig({ projects: [] }).stats)
}, 30_000)

afterAll(async () => { await db?.close() })

it("adds a task's pings of the period to its cost and weekly share, and gives their part apart", async () => {
  const period = data(await reader.period(query))
  const warm = period.tasks.find((row) => row.task === 'ABC-1')!
  expect(warm.cost).toBeCloseTo(2 + 1)
  expect(warm.warmCost).toBeCloseTo(1)
  expect(warm.warmPings).toBe(1)
  expect(warm.limit).toBeCloseTo((3 * 3) / 4)
  const cold = period.tasks.find((row) => row.task === 'ABC-2')!
  expect([cold.cost, cold.warmCost, cold.warmPings]).toEqual([1, null, 0])
})

it("leaves out the pings of another account's session when the page is on one account", async () => {
  const period = data(await reader.period({ ...query, account: 'a' }))
  expect(period.tasks.map((row) => row.task).sort()).toEqual(['ABC-1', 'ABC-2'])
  const all = data(await reader.period(query))
  expect(all.tasks.find((row) => row.task === 'ABC-3')).toMatchObject({ warmPings: 1 })
  expect(all.tasks.find((row) => row.task === 'ABC-3')!.cost).toBeCloseTo(1 + 2)
})

it("gives a task's session its pings of all time", async () => {
  const detail = data(await reader.task('ABC-1'))
  const session = detail.sessions.find((each) => each.sessionId === 'warm')!
  expect(session.cost).toBeCloseTo(2 + 1 + 1)
  expect(session.warmCost).toBeCloseTo(2)
  expect(session.warmPings).toBe(2)
})
