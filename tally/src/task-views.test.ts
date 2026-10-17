import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate, pgliteDb } from './migrations.js'

// The task of a message and of a session (BTN-79) on the whole schema in an in-memory PGlite.

type Message = [id: string, session: string, task: string | null, at: string]

describe('task of a message', () => {
  let db: PGlite

  beforeAll(async () => {
    db = await PGlite.create()
    await db.exec(`set timezone = 'UTC'`)
    await migrate(pgliteDb(db))
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
  }, 30_000)

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

  it('names the model family of a Codex task gpt', async () => {
    await db.exec(`insert into sessions (session_id, account, launch_task) values ('codex', 'codex', 'ABC-7')`)
    await db.query(
      `insert into messages (message_id, session_id, account, model, at, input, cache_write_5m, cache_write_1h, cache_read, output)
       values ('x1', 'codex', 'codex', 'gpt-5.6-luna', '2026-10-01T14:00:00Z', 1, 0, 0, 0, 1)`,
    )
    const { rows } = await db.query<{ model_family: string | null }>(`select model_family from task_estimates where task = 'ABC-7'`)
    expect(rows).toEqual([{ model_family: 'gpt' }])
  })
})

type Named = [session: string, branchTask: string | null, custom: string | null, ai: string | null, prompt: string | null, launch?: string]

describe('task named by the session itself', () => {
  let db: PGlite

  beforeAll(async () => {
    db = await PGlite.create()
    await db.exec(`set timezone = 'UTC'`)
    await migrate(pgliteDb(db))
    const sessions: Named[] = [
      ['other', 'CBL-157', null, 'CBL-169', 'делай CBL-169'],
      ['lower', 'CBL-157', null, 'Кеширование путей', 'делаем cbl-170 потому что'],
      ['own', 'CBL-157', null, 'CBL-157 подзадачи', 'посмотри подзадачи CBL-157, кроме CBL-160'],
      ['own-late', 'CBL-157', null, null, 'сравни CBL-160 с CBL-157'],
      ['title-first', 'CBL-157', null, 'CBL-143', 'глянь, вроде CBL-127 уже сделали'],
      ['custom', 'CBL-157', 'CBL-171', 'CBL-165', 'делай CBL-165'],
      ['silent', 'CBL-157', null, 'Названия планет', 'придумай названия планет'],
      ['foreign', 'CBL-157', null, 'Even Keel', 'посмотри BTN-80'],
      ['digits', 'CBL-157', null, null, 'XCBL-12 и CBL-X не задачи этой ветки'],
      ['chain', 'CBL-157', null, 'CBL-169', 'делай CBL-169', 'CBL-158'],
      ['main', null, null, 'CBL-169', 'делай CBL-169'],
    ]
    for (const [session, task, custom, ai, prompt, launch] of sessions) {
      await db.query(
        `insert into sessions (session_id, account, custom_title, ai_title, prompt, launch_task) values ($1, 'a', $2, $3, $4, $5)`,
        [session, custom, ai, prompt, launch ?? null],
      )
      await db.query(
        `insert into messages (message_id, session_id, account, task, at, input, cache_write_5m, cache_write_1h, cache_read, output)
         values ($1, $1, 'a', $2, '2026-10-01T10:00:00Z', 0, 0, 0, 0, 0)`,
        [session, task],
      )
    }
  }, 30_000)

  afterAll(async () => {
    await db?.close()
  })

  async function tasks(): Promise<Record<string, string | null>> {
    const { rows } = await db.query<{ session_id: string; task: string | null }>('select session_id, task from session_tasks')
    return Object.fromEntries(rows.map((row) => [row.session_id, row.task]))
  }

  it('trusts the prompt and the title over the branch when they name another task of its project', async () => {
    const found = await tasks()
    expect([found.other, found.lower]).toEqual(['CBL-169', 'CBL-170'])
  })

  it('keeps the branch task when the session names it anywhere', async () => {
    const found = await tasks()
    expect([found.own, found['own-late']]).toEqual(['CBL-157', 'CBL-157'])
  })

  it('reads the custom title first, then the generated title, then the prompt', async () => {
    const found = await tasks()
    expect([found['title-first'], found.custom]).toEqual(['CBL-143', 'CBL-171'])
  })

  it('keeps the branch task when the session names no task of its project', async () => {
    const found = await tasks()
    expect([found.silent, found.foreign, found.digits]).toEqual(['CBL-157', 'CBL-157', 'CBL-157'])
  })

  it('leaves the launch journal and sessions without a branch task alone', async () => {
    const found = await tasks()
    expect([found.chain, found.main]).toEqual(['CBL-158', null])
  })
})
