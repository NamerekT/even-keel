import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate, pgliteDb, STEPS } from './migrations.js'

// Step 11 (BTN-859): older responses get their provider, OpenCode's databases are read again, prices keep a source.
describe('the catalogue prices step', () => {
  let db: PGlite

  beforeAll(async () => {
    db = await PGlite.create()
    await migrate(pgliteDb(db), STEPS.slice(0, 10))
    const row = (id: string, entrypoint: string | null) =>
      `('${id}', 's', 'a', ${entrypoint === null ? 'null' : `'${entrypoint}'`}, '2026-10-29 10:00Z', 1, 0, 0, 0, 1)`
    const file = (path: string) => `('${path}', 'a', 1, 1, '2026-10-29 10:00Z', '1', '', 0)`
    await db.exec(`
      insert into messages (message_id, session_id, account, entrypoint, at, input, cache_write_5m, cache_write_1h, cache_read, output) values
        ${row('msg_1', 'cli')}, ${row('msg_2', null)}, ${row('resp_1', 'codex-exec')}, ${row('codex:s:1', 'codex')},
        ${row('opencode:m1', 'opencode')}, ${row('copilot:c1', 'copilot')}, ${row('tally-classify:s:m', 'tally-classify')};
      insert into files (path, account, read_to, size, mtime, ino, head, head_len) values
        ${file('C:\\oc\\data\\opencode\\opencode.db')}, ${file('C:\\claude\\projects\\p\\s.jsonl')};
      insert into model_prices (model, input, output, cache_read, cache_write_5m, cache_write_1h) values ('claude-opus-9', 1, 1, 1, 1, 1);
    `)
    await migrate(pgliteDb(db))
  }, 30_000)

  afterAll(async () => {
    await db?.close()
  })

  it('names Anthropic for Claude, OpenAI for Codex and nobody for the rest', async () => {
    const { rows } = await db.query<{ message_id: string; provider: string | null }>('select message_id, provider from messages order by message_id')
    expect(Object.fromEntries(rows.map((row) => [row.message_id, row.provider]))).toEqual({
      'codex:s:1': 'openai',
      'copilot:c1': null,
      msg_1: 'anthropic',
      msg_2: 'anthropic',
      'opencode:m1': null,
      resp_1: 'openai',
      'tally-classify:s:m': null,
    })
  })

  it("forgets only OpenCode's read marks and keeps the config's prices", async () => {
    expect((await db.query<{ path: string }>('select path from files')).rows).toEqual([{ path: 'C:\\claude\\projects\\p\\s.jsonl' }])
    expect((await db.query('select model, source from model_prices')).rows).toEqual([{ model: 'claude-opus-9', source: 'config' }])
  })
})
