import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { SESSION_FOLDERS } from '../../tally/src/db.js'
import { migrate, pgliteDb } from '../../tally/src/migrations.js'
import { parseConfig } from '../config.js'
import { StatsReader } from './reader.js'
import type { StatsAnswer } from './model.js'

// The cold agent of a task on /stats (BTN-1530): keep-warm warms only the session's cache, so an agent's request after
// a pause longer than its cache's lifetime that wrote its context instead of reading it is counted beside the pings.

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
  await db.exec(`insert into model_prices (model, input, output, cache_read, cache_write_5m, cache_write_1h) values ('claude-haiku-5-5', 1, 1, 0.1, 1, 2)`)
  await db.exec(`insert into sessions (session_id, account, launch_task, launch_reason) values ('s', 'a', 'ABC-1', 'launch'), ('t', 'a', 'ABC-2', 'launch')`)
  const row = (id: string, session: string, agent: string | null, at: string, write5m: number, write1h: number, read: number) =>
    `('${id}', '${session}', ${agent === null ? 'null' : `'${agent}'`}, 'a', 'C:/abc', '${session === 's' ? 'ABC-1' : 'ABC-2'}', '${at}', 'claude-haiku-5-5', 0, ${write5m}, ${write1h}, ${read}, 0)`
  await db.exec(`insert into messages (message_id, session_id, agent_id, account, project_dir, task, at, model, input, cache_write_5m, cache_write_1h, cache_read, output) values
    ${[
      // The main thread rebuilt after half an hour: the session's own miss, not an agent's.
      row('m1', 's', null, '2026-11-03T12:00:00Z', 1000, 0, 0),
      row('m2', 's', null, '2026-11-03T12:30:00Z', 1000000, 0, 0),
      // A five-minute agent: warm after 2 minutes, cold after 7 minutes.
      row('x1', 's', 'x', '2026-11-03T12:01:00Z', 1000, 0, 0),
      row('x2', 's', 'x', '2026-11-03T12:03:00Z', 100, 0, 1000),
      row('x3', 's', 'x', '2026-11-03T12:10:00Z', 1000000, 0, 0),
      // An hour's agent: writing more than it reads after 30 minutes is new context, after 75 minutes a miss.
      row('y1', 's', 'y', '2026-11-03T12:00:00Z', 0, 1000, 0),
      row('y2', 's', 'y', '2026-11-03T12:30:00Z', 0, 5000, 1000),
      row('y3', 's', 'y', '2026-11-03T13:45:00Z', 0, 1000000, 0),
      // A five-minute agent whose cache outlived a 20-minute pause: it read, so no miss.
      row('z1', 's', 'z', '2026-11-03T12:00:00Z', 1000, 0, 0),
      row('z2', 's', 'z', '2026-11-03T12:20:00Z', 100, 0, 1000),
      // A miss before the period: in the session's detail, not in the period's row.
      row('w1', 't', 'w', '2026-10-20T12:00:00Z', 1000, 0, 0),
      row('w2', 't', 'w', '2026-10-20T12:10:00Z', 1000000, 0, 0),
      row('w3', 't', 'w', '2026-11-03T12:00:00Z', 100, 0, 1000),
    ].join(',\n')}`)
  await db.exec(SESSION_FOLDERS)
  reader = new StatsReader({ host: 'localhost', port: 1, database: 'tally', user: 'reader', password: 'fake' },
    () => ({ ABC: 'C:/abc' }), () => parseConfig({ projects: [] }).stats)
}, 30_000)

afterAll(async () => { await db?.close() })

it("counts a task's agent requests of the period that wrote their context again after their cache's lifetime", async () => {
  const period = data(await reader.period(query))
  const task = period.tasks.find((row) => row.task === 'ABC-1')!
  expect(task.agentMisses).toBe(2)
  expect(task.agentMissCost).toBeCloseTo(1 + 2)
  const before = period.tasks.find((row) => row.task === 'ABC-2')!
  expect([before.agentMisses, before.agentMissCost]).toEqual([0, null])
})

it("gives a task's session its agents' misses of all time", async () => {
  const session = data(await reader.task('ABC-2')).sessions.find((each) => each.sessionId === 't')!
  expect(session.agentMisses).toBe(1)
  expect(session.agentMissCost).toBeCloseTo(1)
  const other = data(await reader.task('ABC-1')).sessions.find((each) => each.sessionId === 's')!
  expect([other.agentMisses, other.agentMissCost]).toEqual([2, expect.closeTo(3)])
})
