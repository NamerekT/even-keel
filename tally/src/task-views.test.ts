import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// The task of a message and of a session (BTN-79) on the whole schema.sql in an in-memory PGlite.
const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')

type Message = [id: string, session: string, task: string | null, at: string]

describe('task of a message', () => {
  let db: PGlite

  beforeAll(async () => {
    db = await PGlite.create()
    await db.exec(`set timezone = 'UTC'`)
    await db.exec(SCHEMA)
    await db.exec(`insert into sessions (session_id, account, launch_task) values
      ('chain', 'a', 'ABC-1'), ('manual', 'a', null), ('plain', 'a', null)`)
    const messages: Message[] = [
      ['c1', 'chain', null, '2026-10-01T10:00:00Z'],
      ['c2', 'chain', 'ABC-9', '2026-10-01T10:01:00Z'],
      ['m1', 'manual', null, '2026-10-01T11:00:00Z'],
      ['m2', 'manual', 'ABC-2', '2026-10-01T11:01:00Z'],
      ['m3', 'manual', 'ABC-3', '2026-10-01T11:02:00Z'],
      ['m4', 'manual', null, '2026-10-01T11:03:00Z'],
      ['p1', 'plain', null, '2026-10-01T12:00:00Z'],
      ['o1', 'orphan', 'ABC-4', '2026-10-01T13:00:00Z'],
    ]
    for (const [id, session, task, at] of messages) {
      await db.query(
        `insert into messages (message_id, session_id, account, task, at, input, cache_write_5m, cache_write_1h, cache_read, output)
         values ($1, $2, 'a', $3, $4, 0, 0, 0, 0, 0)`,
        [id, session, task, at],
      )
    }
  })

  afterAll(async () => {
    await db?.close()
  })

  async function tasks(): Promise<Record<string, string | null>> {
    const { rows } = await db.query<{ message_id: string; task: string | null }>(
      'select message_id, task from message_costs order by message_id',
    )
    return Object.fromEntries(rows.map((row) => [row.message_id, row.task]))
  }

  it('gives every message of a chain session its launch task', async () => {
    const found = await tasks()
    expect([found.c1, found.c2]).toEqual(['ABC-1', 'ABC-1'])
  })

  it('gives every message of a manual session the task of its first message with one', async () => {
    const found = await tasks()
    expect([found.m1, found.m2, found.m3, found.m4]).toEqual(['ABC-2', 'ABC-2', 'ABC-2', 'ABC-2'])
  })

  it('leaves a session without any task without one', async () => {
    expect((await tasks()).p1).toBeNull()
  })

  it('keeps the own task of a message whose session is unknown', async () => {
    expect((await tasks()).o1).toBe('ABC-4')
  })

  it('agrees with session_tasks for every session', async () => {
    const { rows } = await db.query<{ session_id: string; task: string | null }>(`
      select distinct c.session_id, c.task from message_costs c
      except
      select session_id, task from session_tasks`)
    expect(rows.filter((row) => row.session_id !== 'orphan')).toEqual([])
  })
})
