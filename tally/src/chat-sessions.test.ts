import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/storage/database.js'
import { CHAT_SESSIONS, chatSessions, type ChatSession } from './chat-sessions.js'
import { migrate, pgliteDb } from './migrations.js'

const PROJECT = '11111111-1111-4111-8111-111111111111'

describe("chatSessions: the chats' sessions of Even Keel's state database (BTN-1233)", { timeout: 120_000 }, () => {
  let state: PGlite

  beforeAll(async () => {
    state = await openDatabase(undefined)
    await state.exec(`
      insert into projects (id, key, repo, branch, position) values ('${PROJECT}', 'ABC', 'C:\\repos\\example', 'main', 0);
      insert into chats (id, project_id, agent, account, session_id, created_at, last_at) values
        ('chat-000000000001', '${PROJECT}', 'claude', 'global', 's-talk', 1, 1),
        ('chat-000000000002', '${PROJECT}', 'claude', 'global', null, 1, 1);`)
  })
  afterAll(() => state.close())

  it('names the session of every chat that has one', async () => {
    expect(await chatSessions(state)).toEqual([{ session: 's-talk', chat: 'chat-000000000001' }])
  })

  it('reads none from a database before the chats', async () => {
    const old = await PGlite.create()
    try {
      expect(await chatSessions(old)).toEqual([])
    } finally {
      await old.close()
    }
  })
})

describe('a chat session is no task of its branch, folder or title (BTN-1233)', () => {
  let db: PGlite
  const sync = (chats: ChatSession[]) => db.query(CHAT_SESSIONS, [JSON.stringify(chats)])

  beforeAll(async () => {
    db = await PGlite.create()
    await db.exec(`set timezone = 'UTC'`)
    await migrate(pgliteDb(db))
    await db.exec(`
      insert into sessions (session_id, account, launch_task, custom_title) values
        ('task', 'a', 'ABC-5', null), ('talk', 'a', null, 'About ABC-7'), ('copy', 'a', null, null);`)
    for (const [id, session, task] of [['m1', 'task', null], ['m2', 'talk', 'ABC-6'], ['m3', 'copy', 'ABC-6']]) {
      await db.query(
        `insert into messages (message_id, session_id, account, task, at, input, cache_write_5m, cache_write_1h, cache_read, output)
         values ($1, $2, 'a', $3, '2026-11-12T10:00:00Z', 0, 0, 0, 0, 0)`,
        [id, session, task],
      )
    }
  }, 30_000)
  afterAll(() => db?.close())

  const sessionTasks = async () =>
    Object.fromEntries((await db.query<{ session_id: string; task: string | null }>('select session_id, task from session_tasks')).rows.map((row) => [row.session_id, row.task]))

  it('takes the task of a session no chat names', async () => {
    expect(await sessionTasks()).toEqual({ task: 'ABC-5', talk: 'ABC-7', copy: 'ABC-6' })
  })

  it('gives a chat session no task, its messages none either, and keeps a session the chat no longer names', async () => {
    await sync([{ session: 'talk', chat: 'chat-000000000001' }, { session: 'copy', chat: 'chat-000000000001' }])
    await sync([{ session: 'talk', chat: 'chat-000000000001' }])
    expect(await sessionTasks()).toEqual({ task: 'ABC-5', talk: null, copy: null })
    const { rows } = await db.query<{ message_id: string; task: string | null }>('select message_id, task from message_costs order by message_id')
    expect(rows.map((row) => row.task)).toEqual(['ABC-5', null, null])
    expect((await db.query('select * from chat_sessions order by session_id')).rows).toEqual([
      { session_id: 'copy', chat: 'chat-000000000001' },
      { session_id: 'talk', chat: 'chat-000000000001' },
    ])
  })
})
