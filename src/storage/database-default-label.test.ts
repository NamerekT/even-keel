import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { databaseVersion, openDatabase, STEPS } from './database.js'
import { ABC, fixture, readsWhole, schemaOf } from './database.fixture.js'
import { currentConfig } from './migrations.js'
import { SCHEMA_VERSION } from './schema.js'

const shared = async (db: PGlite) => {
  const { rows } = await db.query<{ project_id: string | null; value: string; updated_by: string }>(
    "select project_id, value, updated_by from setting_values where key = 'chain.excludedLabels' order by project_id nulls first",
  )
  return rows.map((row) => [row.project_id, JSON.parse(row.value), row.updated_by])
}

const step = async (db: PGlite, from: number) =>
  db.transaction(async (tx) => {
    await tx.query("select set_config('even_keel.migration_from', $1, true)", [String(from)])
    await tx.exec(STEPS[43]!)
  })

describe('step 46: no default excluded label (BTN-971)', { timeout: 120_000 }, () => {
  it('makes the tables of the frozen sample', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 44))
    try {
      await frozen.exec(fixture(46))
      expect(await databaseVersion(frozen)).toBe(46)
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
      await readsWhole(frozen, 46, 46)
    } finally {
      await Promise.all([frozen.close(), made.close()])
    }
  })

  it('writes the shared `["Manual"]` into an existing database that kept no shared list', async () => {
    const db = await PGlite.create()
    try {
      await db.exec(fixture(45))
      await db.exec("delete from setting_values where key = 'chain.excludedLabels' and project_id is null")
      await step(db, 45)
      expect(await shared(db)).toEqual([[null, ['Manual'], 'service'], [ABC, ['Later', 'Manual', 'Вручную'], 'page']])
    } finally {
      await db.close()
    }
  })

  it('leaves a shared list the database keeps as it is, an empty one too', async () => {
    const db = await PGlite.create()
    try {
      await db.exec(fixture(45))
      await step(db, 45)
      expect((await shared(db))[0]).toEqual([null, ['Manual', 'Вручную'], 'service'])
      await db.exec("update setting_values set value = '[]', updated_by = 'page' where key = 'chain.excludedLabels' and project_id is null")
      await step(db, 45)
      expect((await shared(db))[0]).toEqual([null, [], 'page'])
    } finally {
      await db.close()
    }
  })

  it('writes nothing into a fresh database', async () => {
    const made = await openDatabase(undefined)
    try {
      expect(await shared(made)).toEqual([])
    } finally {
      await made.close()
    }
  })

  it('config schema v36 writes Even Keel’s `["Manual"]` into a file that left the list out', () => {
    const project = { key: 'ABC', chain: { requiredLabels: ['agent'] } }
    expect(currentConfig({ version: 35, projects: [project] })).toEqual({ version: SCHEMA_VERSION, chain: { excludedLabels: ['Manual'] }, projects: [project] })
    expect(currentConfig({ version: 35, chain: { terminal: ['Done'] }, projects: [] })).toEqual({
      version: SCHEMA_VERSION,
      chain: { terminal: ['Done'], excludedLabels: ['Manual'] },
      projects: [],
    })
    expect(currentConfig({ version: 35, chain: { excludedLabels: [] }, projects: [] })).toEqual({ version: SCHEMA_VERSION, chain: { excludedLabels: [] }, projects: [] })
    expect(currentConfig({ version: 35, chain: { excludedLabels: ['Later'] }, projects: [] })).toEqual({ version: SCHEMA_VERSION, chain: { excludedLabels: ['Later'] }, projects: [] })
    expect(currentConfig({ version: SCHEMA_VERSION, projects: [] })).toEqual({ version: SCHEMA_VERSION, projects: [] })
  })
})
