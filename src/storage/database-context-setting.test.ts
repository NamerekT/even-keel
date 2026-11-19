import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { fixture, readsWhole } from './database.fixture.js'
import { STEPS } from './database.js'
import { currentConfig } from './migrations.js'
import { SCHEMA_VERSION } from './schema.js'

it('removes the fallback window from older config files and preserves both thresholds', () => {
  const raw = { version: 40, projects: [], context: { window: 150_000, warn: 65, danger: 90 } }
  expect(currentConfig(raw)).toEqual({ version: SCHEMA_VERSION, projects: [], context: { warn: 65, danger: 90 } })
})

it('step 68 removes the stored window and keeps the custom warning threshold', { timeout: 120_000 }, async () => {
  const db = await PGlite.create()
  const frozen = await PGlite.create()
  try {
    await db.exec(fixture(67))
    await db.exec(`
      insert into setting_definitions (key, kind, spec, scopes) values
        ('context.window', 'integer', '{}', 'global'), ('context.warn', 'number', '{}', 'global');
      insert into setting_values (key, value, updated_at, updated_by) values
        ('context.window', '150000', '2026-11-19T09:00:00.000Z', 'page'),
        ('context.warn', '65', '2026-11-19T09:00:00.000Z', 'page');
    `)
    await db.exec(STEPS[65]!)
    const definitions = "select key from setting_definitions where key like 'context.%'"
    const values = "select key, value from setting_values where key like 'context.%'"
    expect((await db.query(definitions)).rows).toEqual([{ key: 'context.warn' }])
    expect((await db.query(values)).rows).toEqual([{ key: 'context.warn', value: '65' }])
    await frozen.exec(fixture(68))
    await readsWhole(frozen, 68, 68)
    expect((await frozen.query(values)).rows).toEqual((await db.query(values)).rows)
  } finally {
    await Promise.all([db.close(), frozen.close()])
  }
})
