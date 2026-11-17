import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { migrate, pgliteDb } from '../../tally/src/migrations.js'
import { parseConfig } from '../config.js'
import { parseStatsFilter, type StatsAnswer } from './model.js'
import { StatsReader } from './reader.js'

const proxy = vi.hoisted(() => ({ query: null as null | ((sql: string, params?: unknown[]) => Promise<unknown>) }))
vi.mock('pg', () => ({ default: { Client: class {}, Pool: class {
  on() {}
  end() { return Promise.resolve() }
  query(sql: string, params?: unknown[]) { return proxy.query!(sql, params) }
} } }))

let db: PGlite
let reader: StatsReader
const query = { scope: 'all' as const, account: null, tz: 'UTC', from: '2026-11-01', to: '2026-11-07', projects: null }
const sessions = async (machine?: string): Promise<number> => {
  const answer = await reader.period({ ...query, ...(machine === undefined ? {} : { machine }) })
  if (answer.state !== 'ok') throw new Error(JSON.stringify(answer))
  return answer.data.current.sessions
}

beforeAll(async () => {
  db = await PGlite.create()
  await migrate(pgliteDb(db))
  proxy.query = (sql, params) => db.query(sql, params)
  await db.exec(`insert into sessions (session_id, account, machine) values
    ('own', 'global', null), ('far-1', 'global@machine-far', 'machine-far'), ('far-2', 'global@machine-far', 'machine-far')`)
  for (const [id, account, machine] of [['own', 'global', null], ['far-1', 'global@machine-far', 'machine-far'], ['far-2', 'global@machine-far', 'machine-far']]) {
    await db.query(`insert into messages (message_id, session_id, account, project_dir, at, model, input, cache_write_5m, cache_write_1h, cache_read, output, machine)
      values ($1, $1, $2, 'C:/abc', '2026-11-03T12:00:00Z', 'claude-sonnet-4-5', 1000, 0, 0, 0, 100, $3)`, [id, account, machine])
  }
  reader = new StatsReader({ host: 'localhost', port: 1, database: 'tally', user: 'reader', password: 'fake' },
    () => ({ ABC: 'C:/abc' }), () => parseConfig({ projects: [] }).stats, undefined, undefined, undefined, () => 'machine-hub')
}, 30_000)

afterAll(async () => { await db?.close() })

it("counts every machine's sessions without a filter, one machine's with it; the hub's own are those without a machine", async () => {
  expect(await sessions()).toBe(3)
  expect(await sessions('machine-far')).toBe(2)
  expect(await sessions('machine-hub')).toBe(1)
  expect(await sessions('machine-none')).toBe(0)
})

it('reads the machine of the address', () => {
  expect(parseStatsFilter(new URLSearchParams('machine=machine-far')).machine).toBe('machine-far')
  expect(parseStatsFilter(new URLSearchParams('machine=')).machine).toBeUndefined()
})
