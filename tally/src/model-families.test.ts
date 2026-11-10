import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { familyOf } from '../../src/stats/base-sql.js'
import { migrate, pgliteDb, STEPS } from './migrations.js'

const MODELS = [
  ['claude-opus-5-5', 'opus'], ['claude-sonnet-4-6', 'sonnet'], ['claude-haiku-4-5', 'haiku'],
  ['claude-fable-5-2', 'fable'], ['gpt-6.1-sol', 'sol'], ['gpt-6-terra', 'terra'],
  ['gpt-6-astra-high', 'astra'], ['openai/gpt-6-luna', 'luna'], ['gpt-5', 'gpt'],
  ['openai/gpt-5', 'gpt'], ['gpt-6-solar', 'gpt'],
  ['deepseek/deepseek-v4.1-flash', 'deepseek'], ['Qwen/Qwen3.5', 'qwen'],
  ['google/gemini-3', 'gemini'], ['kimi-k2', 'kimi'], ['glm-5', 'glm'],
  ['mistral/mistral-large', 'mistral'], ['meta/llama-4', 'llama'],
  ['unknown', null], ['minimax-m2', null], ['', null], [null, null],
] as const

describe('task model families upgraded from v13', () => {
  let db: PGlite
  let columns: unknown[]

  beforeAll(async () => {
    db = await PGlite.create()
    await migrate(pgliteDb(db), STEPS.slice(0, 13))
    columns = (await db.query(`select column_name, data_type from information_schema.columns
      where table_name = 'task_estimates' order by ordinal_position`)).rows
    for (const [index, [model]] of MODELS.entries()) {
      const session = `s${index}`
      await db.query(`insert into sessions (session_id, account, launch_task) values ($1, 'a', $2)`, [session, `ABC-${index + 1}`])
      await db.query(`insert into messages (message_id, session_id, account, model, at, input, cache_write_5m, cache_write_1h, cache_read, output)
        values ($1, $1, 'a', $2, '2026-10-01T10:00:00Z', 1, 0, 0, 0, 1)`, [session, model])
    }
    await migrate(pgliteDb(db))
  }, 30_000)

  afterAll(async () => { await db?.close() })

  it.each(MODELS)('groups existing model %s as %s, matching /stats', async (model, expected) => {
    const index = MODELS.findIndex(([candidate]) => candidate === model)
    const { rows } = await db.query(`select e.model_family, ${familyOf('s.model')} as stats_family
      from task_estimates e join audit_sessions s on s.task = e.task where e.task = $1`, [`ABC-${index + 1}`])
    expect(rows).toEqual([{ model_family: expected, stats_family: expected }])
  })

  it('preserves the columns and skips an already applied upgrade', async () => {
    expect((await db.query(`select column_name, data_type from information_schema.columns
      where table_name = 'task_estimates' order by ordinal_position`)).rows).toEqual(columns)
    const before = (await db.query('select * from task_estimates order by task')).rows
    expect(await migrate(pgliteDb(db))).toEqual({ state: 'current', version: STEPS.length })
    expect((await db.query('select * from task_estimates order by task')).rows).toEqual(before)
  })
})
