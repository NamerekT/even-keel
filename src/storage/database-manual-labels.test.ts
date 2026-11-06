import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { databaseVersion, openDatabase, STEPS } from './database.js'
import { ABC, FEED, fixture, schemaOf } from './database.fixture.js'
import { currentConfig } from './migrations.js'
import { SCHEMA_VERSION } from './schema.js'

const PROFILE = '55555555-5555-4555-8555-555555555555'

const excluded = async (db: PGlite) => {
  const values = await db.query<{ project_id: string | null; value: string }>(
    "select project_id, value from setting_values where key = 'chain.excludedLabels' order by project_id nulls first",
  )
  const profile = await db.query<{ rules: string }>('select rules from tracker_profiles where id = $1', [PROFILE])
  const feeds = await db.query<{ feeds: string }>('select feeds from projects where id = $1', [ABC])
  const feed = (JSON.parse(feeds.rows[0]!.feeds) as { id: string; chain?: { excludedLabels?: string[] } }[]).find((each) => each.id === FEED)
  return {
    values: values.rows.map((row) => [row.project_id, JSON.parse(row.value)]),
    profile: JSON.parse(profile.rows[0]!.rules).excludedLabels,
    feed: feed?.chain?.excludedLabels,
  }
}

const step = async (db: PGlite, from: number) =>
  db.transaction(async (tx) => {
    await tx.query("select set_config('even_keel.migration_from', $1, true)", [String(from)])
    await tx.exec(STEPS[25]!)
  })

describe('step 28: no built-in excluded label (BTN-758)', () => {
  it('makes the tables of the frozen sample', { timeout: 120_000 }, async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 26))
    try {
      await frozen.exec(fixture(28))
      expect(await databaseVersion(frozen)).toBe(28)
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    } finally {
      await Promise.all([frozen.close(), made.close()])
    }
  })

  it('writes `Manual` and `Вручную` into every list an existing database keeps, and Even Keel’s where it had none', { timeout: 120_000 }, async () => {
    const db = await PGlite.create()
    try {
      await db.exec(fixture(27))
      await step(db, 27)
      expect(await excluded(db)).toEqual({
        values: [[null, ['Manual', 'Вручную']], [ABC, ['Later', 'Manual', 'Вручную']]],
        profile: ['wontfix', 'Manual', 'Вручную'],
        feed: ['Later', 'Manual', 'Вручную'],
      })
    } finally {
      await db.close()
    }
  })

  it('leaves a list that names them already as it is, whatever their case, and fills Even Keel’s own empty one', { timeout: 120_000 }, async () => {
    const db = await PGlite.create()
    try {
      await db.exec(fixture(27))
      await db.exec(`
        update setting_values set value = '["manual", "Вручную", "Later"]' where key = 'chain.excludedLabels' and project_id = '${ABC}';
        insert into setting_values (key, project_id, qualifier, value, updated_at, updated_by)
          values ('chain.excludedLabels', null, '', '[]', '2026-11-01T09:00:00.000Z', 'page');
      `)
      await step(db, 27)
      const { values } = await excluded(db)
      expect(values).toEqual([[null, ['Manual', 'Вручную']], [ABC, ['manual', 'Вручную', 'Later']]])
    } finally {
      await db.close()
    }
  })

  it('config schema v28 does the same to a file: every list, Even Keel’s written where it had none', () => {
    const feed = { id: 'f1', chain: { excludedLabels: ['wip'] } }
    const raw = { version: 27, chain: { requiredLabels: ['agent'] }, projects: [{ key: 'ABC', chain: { excludedLabels: ['MANUAL'] }, feeds: [feed, { id: 'f2' }] }, { key: 'XYZ' }] }
    const migrated = currentConfig(raw)
    expect(migrated).toEqual({
      version: SCHEMA_VERSION,
      chain: { requiredLabels: ['agent'], excludedLabels: ['Manual', 'Вручную'] },
      projects: [{ key: 'ABC', chain: { excludedLabels: ['MANUAL', 'Вручную'] }, feeds: [{ id: 'f1', chain: { excludedLabels: ['wip', 'Manual', 'Вручную'] } }, { id: 'f2' }] }, { key: 'XYZ' }],
    })
    expect(currentConfig(migrated)).toEqual(migrated)
    expect(currentConfig({ version: 27, chain: { excludedLabels: [] }, projects: [] })).toEqual({ version: SCHEMA_VERSION, chain: { excludedLabels: ['Manual', 'Вручную'] }, projects: [] })
    expect(currentConfig({ version: SCHEMA_VERSION, projects: [] })).toEqual({ version: SCHEMA_VERSION, projects: [] })
  })

  it('writes nothing into a fresh database: it keeps the default `["Manual"]`', { timeout: 120_000 }, async () => {
    const made = await openDatabase(undefined)
    try {
      expect((await made.query("select value from setting_values where key = 'chain.excludedLabels'")).rows).toEqual([])
    } finally {
      await made.close()
    }
  })
})
