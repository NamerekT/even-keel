import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate, pgliteDb, STEPS } from './migrations.js'

// Step 9 (BTN-626): a Codex turn stopped between a record and its token_count left every later token_count written as a response too.
describe('codex stray token_count rows', () => {
  let db: PGlite

  beforeAll(async () => {
    db = await PGlite.create()
    await migrate(pgliteDb(db), STEPS.slice(0, 8))
    const row = (id: string, session: string, entrypoint: string, at: string) =>
      `('${id}', '${session}', 'codex', '${entrypoint}', '2026-10-29 ${at}Z', 1, 0, 0, 0, 1)`
    await db.exec(`
      insert into messages (message_id, session_id, account, entrypoint, at, input, cache_write_5m, cache_write_1h, cache_read, output) values
        ${row('resp_1', 's1', 'codex-exec', '10:00')},
        ${row('resp_2', 's1', 'codex-exec', '10:05')},
        ${row('codex:s1:4400', 's1', 'codex-exec', '10:05')},
        ${row('codex:s1:8800', 's1', 'codex-exec', '10:06')},
        ${row('codex:s2:100', 's2', 'codex', '09:00')},
        ${row('resp_3', 's2', 'codex', '10:00')},
        ${row('codex:s2:900', 's2', 'codex', '10:01')},
        ${row('codex:s3:100', 's3', 'codex', '10:00')},
        ${row('codex:s3:200', 's3', 'codex', '10:01')},
        ${row('msg_1', 's4', 'cli', '10:00')};
    `)
    await migrate(pgliteDb(db))
  }, 30_000)

  afterAll(async () => {
    await db.close()
  })

  it('drops the token_count rows from the first record of a session on, keeping those before it and sessions without records', async () => {
    const { rows } = await db.query<{ message_id: string }>('select message_id from messages order by message_id')
    expect(rows.map((row) => row.message_id)).toEqual(['codex:s2:100', 'codex:s3:100', 'codex:s3:200', 'msg_1', 'resp_1', 'resp_2', 'resp_3'])
  })
})
