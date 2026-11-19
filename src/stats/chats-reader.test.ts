import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { CHAT_SESSIONS } from '../../tally/src/chat-sessions.js'
import { SESSION_FOLDERS } from '../../tally/src/db.js'
import { migrate, pgliteDb } from '../../tally/src/migrations.js'
import { parseConfig } from '../config.js'
import { StatsReader } from './reader.js'
import type { StatsAnswer } from './model.js'

// Project chats on /stats (BTN-1233): their spend per project next to the tasks, never in a task's row.

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
  await db.exec(`insert into model_prices (model, input, output, cache_read, cache_write_5m, cache_write_1h) values ('qwen-9', 1, 1, 0, 0, 0)`)
  await db.exec(`insert into sessions (session_id, account, launch_task, launch_reason) values
    ('task', 'a', 'ABC-1', 'launch'), ('talk', 'a', null, null), ('again', 'a', null, null), ('other', 'a', null, null), ('older', 'a', null, null)`)
  // The checkout of the chat `talk` was left on a task branch: its messages carry that task, and it is still a chat's.
  const messages: [id: string, session: string, dir: string, task: string | null, at: string, input: number][] = [
    ['m1', 'task', 'C:/abc/.claude/worktrees/abc-1', 'ABC-1', '2026-11-03T12:00:00Z', 4_000_000],
    ['c1', 'talk', 'C:/abc', 'ABC-1', '2026-11-03T13:00:00Z', 1_000_000],
    ['c2', 'again', 'C:/abc', null, '2026-11-04T13:00:00Z', 2_000_000],
    ['c3', 'other', 'C:/def', null, '2026-11-04T14:00:00Z', 1_000_000],
    ['c4', 'older', 'C:/abc', null, '2026-10-20T14:00:00Z', 5_000_000],
  ]
  for (const [id, session, dir, task, at, input] of messages) {
    await db.query(`insert into messages (message_id, session_id, account, project_dir, task, at, model, input, cache_write_5m, cache_write_1h, cache_read, output)
      values ($1, $2, 'a', $3, $4, $5, 'qwen-9', $6, 0, 0, 0, 0)`, [id, session, dir, task, at, input])
  }
  await db.query(CHAT_SESSIONS, [JSON.stringify([
    { session: 'talk', chat: 'chat-000000000001' },
    { session: 'again', chat: 'chat-000000000001' },
    { session: 'other', chat: 'chat-000000000002' },
    { session: 'older', chat: 'chat-000000000003' },
  ])])
  await db.exec(SESSION_FOLDERS)
  reader = new StatsReader({ host: 'localhost', port: 1, database: 'tally', user: 'reader', password: 'fake' },
    () => ({ ABC: 'C:/abc', DEF: 'C:/def' }), () => parseConfig({ projects: [] }).stats)
}, 30_000)

afterAll(async () => { await db?.close() })

it("counts a project's chats and their spend in the period, apart from the tasks", async () => {
  const period = data(await reader.period(query))
  expect(period.chats).toEqual([
    { project: 'ABC', chats: 1, sessions: 2, cost: 3, limit: null },
    { project: 'DEF', chats: 1, sessions: 1, cost: 1, limit: null },
  ])
  expect(period.tasks.map((row) => [row.task, row.cost, row.sessions])).toEqual([['ABC-1', 4, 1]])
  expect(period.current.cost).toBeCloseTo(8)
})

it('keeps to the projects asked for', async () => {
  expect(data(await reader.period({ ...query, projects: ['DEF'] })).chats.map((row) => row.project)).toEqual(['DEF'])
})
