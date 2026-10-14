import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MESSAGE_EFFORTS } from './db.js'
import { migrate, pgliteDb } from './migrations.js'

// The effort level of messages loaded before it was parsed, and of a session, on the whole schema in PGlite.
type Message = [id: string, session: string, agent: string | null, effort: string | null]

describe('effort level', () => {
  let db: PGlite

  beforeAll(async () => {
    db = await PGlite.create()
    await migrate(pgliteDb(db))
    const messages: Message[] = [
      ['h1', 'high', null, 'high'],
      ['h2', 'high', null, 'high'],
      ['h3', 'high', null, 'xhigh'],
      ['h4', 'high', 'a1', 'xhigh'],
      ['h5', 'high', 'a1', 'xhigh'],
      ['o1', 'old', null, null],
      ['o2', 'old', null, null],
    ]
    for (const [id, session, agent, effort] of messages) {
      await db.query(
        `insert into messages (message_id, session_id, agent_id, account, effort, input, cache_write_5m, cache_write_1h, cache_read, output)
         values ($1, $2, $3, 'a', $4, 0, 0, 0, 0, 0)`,
        [id, session, agent, effort],
      )
    }
    const lines: [uuid: string, raw: object][] = [
      ['l1', { type: 'assistant', effort: 'medium', message: { id: 'o1' } }],
      ['l2', { type: 'assistant', effort: 'medium', message: { id: 'o1' } }],
      ['l3', { type: 'assistant', message: { id: 'o2' } }],
      ['l4', { type: 'assistant', effort: 'max', message: { id: 'h1' } }],
    ]
    for (const [uuid, raw] of lines) {
      await db.query(`insert into lines (uuid, session_id, type, raw) values ($1, 'old', 'assistant', $2)`, [uuid, raw])
    }
    await db.exec(MESSAGE_EFFORTS)
  }, 30_000)

  afterAll(async () => {
    await db?.close()
  })

  it('fills the effort of older messages from their stored lines and keeps a known one', async () => {
    const { rows } = await db.query<{ message_id: string; effort: string | null }>(
      `select message_id, effort from messages where message_id in ('o1', 'o2', 'h1') order by message_id`,
    )
    expect(rows).toEqual([
      { message_id: 'h1', effort: 'high' },
      { message_id: 'o1', effort: 'medium' },
      { message_id: 'o2', effort: null },
    ])
  })

  it('gives a session the most frequent effort of its main thread and marks a mix', async () => {
    const { rows } = await db.query<{ session_id: string; effort: string; mixed: boolean }>(
      'select session_id, effort, mixed from session_efforts order by session_id',
    )
    expect(rows).toEqual([
      { session_id: 'high', effort: 'high', mixed: true },
      { session_id: 'old', effort: 'medium', mixed: false },
    ])
  })
})
