import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { SESSION_FOLDERS } from '../../tally/src/db.js'
import { migrate, pgliteDb } from '../../tally/src/migrations.js'
import { parseConfig } from '../config.js'
import { StatsReader } from './reader.js'
import type { StatsAnswer } from './model.js'

const proxy = vi.hoisted(() => ({ query: null as null | ((sql: string, params?: unknown[]) => Promise<unknown>) }))
vi.mock('pg', () => ({ default: { Pool: class {
  on() {}
  end() { return Promise.resolve() }
  query(sql: string, params?: unknown[]) { return proxy.query!(sql, params) }
} } }))

let db: PGlite
let hidden: string[] = ['TSK']
let reader: StatsReader
const filter = { scope: 'all' as const, account: null, tz: 'UTC' }
const query = { ...filter, from: '2026-11-01', to: '2026-11-07', projects: null }
const data = <T,>(answer: StatsAnswer<T>): T => {
  expect(answer.state).toBe('ok')
  if (answer.state !== 'ok') throw new Error(JSON.stringify(answer))
  return answer.data
}

beforeAll(async () => {
  db = await PGlite.create()
  await migrate(pgliteDb(db))
  proxy.query = (sql, params) => db.query(sql, params)
  await db.exec(`insert into sessions (session_id, account, launch_task, launch_reason) values
    ('ordinary', 'a', 'ABC-1', 'launch'), ('test', 'a', 'TSK-1', 'launch'), ('manual-test', 'a', null, null)`)
  for (const [id, task, dir] of [['ordinary', 'ABC-1', 'C:/abc'], ['test', 'TSK-1', 'C:/sandbox'], ['manual-test', null, 'C:/sandbox']]) {
    await db.query(`insert into messages (message_id, session_id, account, project_dir, task, at, model, input, cache_write_5m, cache_write_1h, cache_read, output)
      values ($1, $1, 'a', $2, $3, '2026-11-03T12:00:00Z', 'claude-sonnet-4-5', 1000, 0, 0, 0, 100)`, [id, dir, task])
  }
  await db.exec(SESSION_FOLDERS)
  reader = new StatsReader({ host: 'localhost', port: 1, database: 'tally', user: 'reader', password: 'fake' },
    () => ({ ABC: 'C:/abc', TSK: 'C:/sandbox' }), () => parseConfig({ projects: [] }).stats, undefined, () => hidden)
}, 30_000)

afterAll(async () => { await db?.close() })

it('filters history, totals, sources and tasks; showing tests uses a separate cached answer', async () => {
  const history = data(await reader.history(filter))
  expect(history.projects).toEqual(['ABC'])
  expect(history.tracked).toEqual(['ABC'])
  const ordinary = data(await reader.period(query))
  expect(ordinary.current.sessions).toBe(1)
  expect(ordinary.tasks.map(row => row.task)).toEqual(['ABC-1'])
  const all = data(await reader.period({ ...query, includeTests: true }))
  expect(all.current.sessions).toBe(3)
  expect(all.current.messages).toBe(3)
  expect(data(await reader.period({ ...query, projects: ['TSK'] })).current.sessions).toBe(0)
  expect(data(await reader.period({ ...query, projects: [], includeTests: true })).current.sessions).toBe(0)
})

it('applies flag changes immediately in both directions without clearing collected data', async () => {
  hidden = []
  expect(data(await reader.history(filter)).projects.sort()).toEqual(['ABC', 'TSK'])
  expect(data(await reader.period(query)).current.sessions).toBe(3)
  hidden = ['TSK']
  expect(data(await reader.period(query)).current.sessions).toBe(1)
  expect((await db.query('select count(*)::int as n from messages')).rows).toEqual([{ n: 3 }])
})

it('keeps steps and comparisons valid with the same hidden-project filter', async () => {
  expect((await reader.steps(query)).state).toBe('ok')
  const compared = await reader.compare({ ...filter, projects: null, before: '2026-11-04T00:00:00Z', after: '2026-11-04T00:00:00Z', days: 7 })
  expect(compared.state).toBe('ok')
})
