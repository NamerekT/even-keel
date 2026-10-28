import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { currentConfig } from './migrations.js'
import { SCHEMA_VERSION } from './schema.js'
import { STEPS } from './database.js'
import { fixture, readsWhole } from './database.fixture.js'

describe('model prompt pattern migration', () => {
  it('reads the frozen database v16 whole with its migrated model prompts', async () => {
    const db = await PGlite.create()
    try {
      await db.exec(fixture(16))
      await readsWhole(db, 16)
      const { rows } = await db.query<{ value: string }>("select value from setting_values where key = 'modelPrompts'")
      expect(Object.entries(JSON.parse(rows[0]!.value))).toEqual([['* | sonnet', 'First.'], ['* | gpt-sol', 'Second.']])
    } finally {
      await db.close()
    }
  })

  it('moves legacy model keys, in order, and leaves current patterns intact', () => {
    const old = { version: 16, projects: [], modelPrompts: { sonnet: 'First.', Codex: 'Second.' } }
    const current = { ...old, version: 17, modelPrompts: { '* | sonnet': 'First.', '* | Codex': 'Second.' } }
    expect(SCHEMA_VERSION).toBe(17)
    expect(currentConfig(old)).toEqual(current)
    expect(currentConfig(current)).toEqual(current)
    expect(currentConfig({ ...old, version: 1 })).toEqual(current)
  })

  it('upgrades the stored setting without changing its writer metadata or row order', async () => {
    const db = await PGlite.create()
    try {
      await db.exec(fixture(15))
      await db.exec("insert into setting_definitions (key, kind, spec, default_value, scopes) values ('modelPrompts', 'json', '{}', '{}', 'global') on conflict do nothing")
      await db.query("insert into setting_values (key, project_id, qualifier, value, updated_at, updated_by) values ('modelPrompts', null, '', $1, '2026-10-01', 'hand')", [JSON.stringify({ sonnet: 'First.', 'gpt-sol': 'Second.' })])
      await db.exec(STEPS[13] ?? '')
      const { rows } = await db.query<{ value: string; updated_at: string; updated_by: string }>("select value, updated_at, updated_by from setting_values where key = 'modelPrompts'")
      expect(Object.entries(JSON.parse(rows[0]!.value))).toEqual([['* | sonnet', 'First.'], ['* | gpt-sol', 'Second.']])
      expect(rows[0]).toMatchObject({ updated_at: '2026-10-01', updated_by: 'hand' })
    } finally {
      await db.close()
    }
  })
})
