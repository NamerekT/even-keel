import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { insertRows, rowsOf } from './copy.js'
import { ABC, fixture, readsWhole, schemaOf, XYZ } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'

const STEP = STEPS[45]!

const models = async (db: PGlite) =>
  (await db.query<{ project_id: string | null; qualifier: string; value: string }>(
    "select project_id, qualifier, value from setting_values where key = 'models' order by project_id nulls first, qualifier",
  )).rows

describe('step 48: OpenCode models by the provider of the account (BTN-984)', { timeout: 120_000 }, () => {
  it('makes the tables of the frozen sample and reads its rows', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 46))
    try {
      await frozen.exec(fixture(48))
      expect(await databaseVersion(frozen)).toBe(48)
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
      await readsWhole(frozen, 48, 48)
      expect(await models(frozen)).toEqual([
        { project_id: null, qualifier: 'opencode/opencode', value: '"opencode/big-pickle"' },
        { project_id: ABC, qualifier: 'claude', value: '"sonnet"' },
        { project_id: ABC, qualifier: 'opencode/openai', value: '"openai/gpt-6-luna"' },
      ])
      await insertRows(made, await rowsOf(frozen))
      expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    } finally {
      await Promise.all([frozen.close(), made.close()])
    }
  })

  it('moves the OpenCode model of each level into the slot its prefix names', async () => {
    const db = await PGlite.create()
    try {
      await db.exec(fixture(47))
      await db.exec(`
        insert into setting_values (key, project_id, qualifier, value, updated_at, updated_by) values
          ('models', null, 'opencode', '"openrouter/x-ai/grok"', '2026-11-01T09:00:00.000Z', 'page'),
          ('models', '${ABC}', 'opencode', '"openai/gpt-6-luna"', '2026-11-01T09:00:00.000Z', 'page'),
          ('models', '${XYZ}', 'opencode', '"big-pickle"', '2026-11-01T09:00:00.000Z', 'page');
      `)
      await db.exec(STEP)
      expect(await models(db)).toEqual([
        { project_id: null, qualifier: 'opencode/openrouter', value: '"openrouter/x-ai/grok"' },
        { project_id: ABC, qualifier: 'claude', value: '"sonnet"' },
        { project_id: ABC, qualifier: 'opencode/openai', value: '"openai/gpt-6-luna"' },
        { project_id: XYZ, qualifier: 'opencode/opencode', value: '"big-pickle"' },
      ])
    } finally {
      await db.close()
    }
  })
})
