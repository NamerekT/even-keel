import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { migrate, pgliteDb } from '../../tally/src/migrations.js'
import { parseConfig } from '../config.js'
import type { CheckpointMeasure } from './checkpoint.js'
import type { StatsAnswer } from './model.js'
import { StatsReader } from './reader.js'

// The calibration's `note` starts at the session's first note, a file or a `handoff_write` call (BTN-1240).

const proxy = vi.hoisted(() => ({ query: null as null | ((sql: string, params?: unknown[]) => Promise<unknown>) }))
vi.mock('pg', () => ({ default: { Client: class {}, Pool: class {
  on() {}
  end() { return Promise.resolve() }
  query(sql: string, params?: unknown[]) { return proxy.query!(sql, params) }
} } }))

let db: PGlite

/** The project's measure from a fresh reader, so no answer comes from the cache; the reader keeps it private. */
const measure = async (): Promise<CheckpointMeasure> => {
  const reader = new StatsReader({ host: 'localhost', port: 1, database: 'tally', user: 'reader', password: 'fake' },
    () => ({ ABC: 'C:/abc' }), () => parseConfig({ projects: [] }).stats)
  const private_ = reader as unknown as { checkpointMeasures(): Promise<StatsAnswer<Record<string, CheckpointMeasure>>> }
  const answer = await private_.checkpointMeasures()
  if (answer.state !== 'ok') throw new Error(JSON.stringify(answer))
  return answer.data.ABC!
}

/** A session of three requests costing the dollars given, its tool call made in the second. */
const session = async (id: string, dollars: [number, number, number], tool: string, brief: string) => {
  await db.query(`insert into sessions (session_id, account, launch_task, launch_reason) values ($1, 'acc', 'ABC-1', 'launch')`, [id])
  for (const [i, usd] of dollars.entries()) {
    await db.query(`insert into messages (message_id, session_id, account, project_dir, task, at, model, input, cache_write_5m, cache_write_1h, cache_read, output)
      values ($1, $2, 'acc', 'C:/abc', 'ABC-1', $3, 'qwen-9', $4, 0, 0, 0, 0)`, [`${id}-${i}`, id, `2026-11-03T12:0${i}:00Z`, usd * 1_000_000])
  }
  await db.query(`insert into tool_calls (tool_use_id, session_id, message_id, task, name, brief, at) values ($1, $2, $3, 'ABC-1', $4, $5, '2026-11-03T12:01:00Z')`,
    [`${id}-tool`, id, `${id}-1`, tool, brief])
}

beforeAll(async () => {
  db = await PGlite.create()
  await migrate(pgliteDb(db))
  proxy.query = (sql, params) => db.query(sql, params)
  await db.exec(`insert into model_prices (model, input, output, cache_read, cache_write_5m, cache_write_1h) values ('qwen-9', 1, 1, 0.1, 0, 0)`)
  await session('file', [1, 2, 3], 'Write', 'D:/w/.temp/handoff.md')
  await session('mcp', [1, 4, 2], 'mcp__plugin_tasks_tasks__handoff_write', '')
  await session('dotted', [1, 3, 4], 'tasks.handoff_write', '')
  await session('underscored', [1, 5, 3], 'tasks_handoff_write', '')
  await session('other', [1, 9, 9], 'mcp__tasks__handoff_write_old', '')
}, 30_000)

afterAll(async () => { await db?.close() })

it('measures the note from a handoff_write call under any agent name of it, as from the note file', async () => {
  // Notes of $5, $6, $7 and $8; the tool of another name keeps no note.
  expect((await measure()).note).toBeCloseTo(6.5)
})

it('takes no handoff_write call for the first edit of the recovery', async () => {
  await db.query(`update sessions set launch_reason = 'checkpoint' where session_id = 'mcp'`)
  await db.query(`insert into tool_calls (tool_use_id, session_id, message_id, task, name, brief, at)
    values ('mcp-edit', 'mcp', 'mcp-2', 'ABC-1', 'Edit', 'src/a.ts', '2026-11-03T12:02:00Z')`)
  expect((await measure()).recovery).toBeCloseTo(1 + 4)
})
