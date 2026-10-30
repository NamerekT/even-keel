import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { databaseVersion, openDatabase, STEPS } from './database.js'
import { fixture, schemaOf } from './database.fixture.js'
import { currentConfig } from './migrations.js'
import { SCHEMA_VERSION } from './schema.js'

const cliRows = async (db: PGlite) =>
  (await db.query<{ qualifier: string; value: string; updated_by: string }>("select qualifier, value, updated_by from setting_values where key = 'cli' and project_id is null order by qualifier")).rows.map(
    (row) => [row.qualifier, JSON.parse(row.value), row.updated_by],
  )

it('step 20 writes `checked` for every provider an existing database left out of `cli`, an explicit value kept', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined)
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(20))
    expect(await databaseVersion(frozen)).toBe(20)
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await upgraded.exec(fixture(19))
    await upgraded.exec("insert into setting_definitions (key, kind, spec, default_value, scopes, qualifier) values ('cli', 'enum', '{}', '{}', 'global', 'provider') on conflict (key) do nothing")
    await upgraded.exec("insert into setting_values (key, project_id, qualifier, value, updated_at, updated_by) values ('cli', null, 'codex', '\"system\"', '2026-10-20', 'page')")
    await upgraded.transaction(async (tx) => {
      await tx.query("select set_config('even_keel.migration_from', '19', true)")
      await tx.exec(STEPS[17]!)
    })
    expect(await cliRows(upgraded)).toEqual([['claude', 'checked', 'service'], ['codex', 'system', 'page'], ['copilot', 'checked', 'service'], ['opencode', 'checked', 'service']])
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})

it('a fresh database keeps the new default of `cli`: no row written', { timeout: 120_000 }, async () => {
  const made = await openDatabase(undefined)
  try {
    expect(await cliRows(made)).toEqual([])
  } finally {
    await made.close()
  }
})

it('config schema v21 writes `checked` for every provider the file left out, an explicit value kept', () => {
  const raw = { version: 20, cli: { codex: 'system' }, projects: [] }
  const migrated = currentConfig(raw)
  expect(migrated).toEqual({ version: SCHEMA_VERSION, cli: { claude: 'checked', codex: 'system', opencode: 'checked', copilot: 'checked' }, projects: [] })
  expect(currentConfig(migrated)).toEqual(migrated)
  expect(currentConfig({ version: 20, projects: [] })).toEqual({ version: SCHEMA_VERSION, cli: { claude: 'checked', codex: 'checked', opencode: 'checked', copilot: 'checked' }, projects: [] })
  expect(currentConfig({ version: SCHEMA_VERSION, projects: [] })).toEqual({ version: SCHEMA_VERSION, projects: [] })
})
