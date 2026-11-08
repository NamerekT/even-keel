import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { SESSION_FOLDERS } from '../../tally/src/db.js'
import { migrate, pgliteDb } from '../../tally/src/migrations.js'
import { parseConfig } from '../config.js'
import { StatsReader } from './reader.js'
import type { StatsAnswer } from './model.js'

// A task's cost as paid where Even Keel read a session's real spend on its key, the estimate in a field of its own (BTN-860).

const proxy = vi.hoisted(() => ({ query: null as null | ((sql: string, params?: unknown[]) => Promise<unknown>) }))
vi.mock('pg', () => ({ default: { Pool: class {
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
  await db.exec(`insert into model_prices (model, input, output, cache_read, cache_write_5m, cache_write_1h) values ('qwen-9', 1, 1, 0, 0, 0)`)
  await db.exec(`insert into sessions (session_id, account, launch_task, launch_reason) values
    ('metered', 'or', 'ABC-1', 'launch'), ('priced', 'or', 'ABC-1', 'relay'), ('shared', 'or', 'ABC-2', 'launch')`)
  const messages: [id: string, session: string, task: string, input: number][] = [
    ['m1', 'metered', 'ABC-1', 1_000_000],
    ['m2', 'metered', 'ABC-1', 3_000_000],
    ['p1', 'priced', 'ABC-1', 2_000_000],
    ['s1', 'shared', 'ABC-2', 1_000_000],
  ]
  for (const [id, session, task, input] of messages) {
    await db.query(`insert into messages (message_id, session_id, account, project_dir, task, at, model, input, cache_write_5m, cache_write_1h, cache_read, output)
      values ($1, $2, 'or', 'C:/abc', $3, '2026-11-03T12:00:00Z', 'qwen-9', $4, 0, 0, 0, 0)`, [id, session, task, input])
  }
  await db.exec(`insert into key_spends (session_id, account, usd, shared, first_at, last_at) values
    ('metered', 'or', 3, false, '2026-11-03T12:00:00Z', '2026-11-03T12:10:00Z'),
    ('shared', 'or', 0, true, '2026-11-03T12:00:00Z', '2026-11-03T12:10:00Z')`)
  await db.exec(SESSION_FOLDERS)
  reader = new StatsReader({ host: 'localhost', port: 1, database: 'tally', user: 'reader', password: 'fake' },
    () => ({ ABC: 'C:/abc' }), () => parseConfig({ projects: [] }).stats)
}, 30_000)

afterAll(async () => { await db?.close() })

it("shows a task's cost as paid and its estimate by price beside it; the period's totals stay on the estimate", async () => {
  const period = data(await reader.period(query))
  const task = period.tasks.find((row) => row.task === 'ABC-1')!
  expect(task.cost).toBeCloseTo(3 + 2)
  expect(task.priceEstimate).toBeCloseTo(4 + 2)
  const shared = period.tasks.find((row) => row.task === 'ABC-2')!
  expect(shared.cost).toBeCloseTo(1)
  expect(shared.priceEstimate).toBeNull()
  expect(period.current.cost).toBeCloseTo(4 + 2 + 1)
})

it("shows a session's real spend with its estimate, and a session without one as priced", async () => {
  const detail = data(await reader.task('ABC-1'))
  const metered = detail.sessions.find((session) => session.sessionId === 'metered')!
  expect(metered.cost).toBeCloseTo(3)
  expect(metered.priceEstimate).toBeCloseTo(4)
  const priced = detail.sessions.find((session) => session.sessionId === 'priced')!
  expect(priced.cost).toBeCloseTo(2)
  expect(priced.priceEstimate).toBeNull()
})
