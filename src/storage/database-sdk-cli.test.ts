import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { databaseVersion, openDatabase, STEPS } from './database.js'
import { fixture, schemaOf } from './database.fixture.js'
import { currentConfig } from './migrations.js'
import { SCHEMA_VERSION } from './schema.js'

const claudeCli = async (db: PGlite) =>
  (await db.query<{ value: string; updated_by: string }>("select value, updated_by from setting_values where key = 'cli' and project_id is null and qualifier = 'claude'")).rows.map(
    (row) => [JSON.parse(row.value), row.updated_by],
  )

const step21 = async (db: PGlite) =>
  db.transaction(async (tx) => {
    await tx.query("select set_config('even_keel.migration_from', '20', true)")
    await tx.exec(STEPS[18]!)
  })

const sdk = "insert into setting_values (key, project_id, qualifier, value, updated_at, updated_by) values ('execution', null, 'claude', '\"sdk\"', '2026-10-30', 'page')"
const execution = "insert into setting_definitions (key, kind, spec, default_value, scopes, qualifier) values ('execution', 'enum', '{}', '{}', 'global', 'provider')"

it('step 21 moves the Agent SDK of Claude off the installed CLI onto the checked copy', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 19))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(21))
    expect(await databaseVersion(frozen)).toBe(21)
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await upgraded.exec(fixture(20))
    await upgraded.exec("update setting_values set value = '\"system\"', updated_by = 'page' where key = 'cli' and qualifier = 'claude'")
    await upgraded.exec(execution)
    await upgraded.exec(sdk)
    await step21(upgraded)
    expect(await claudeCli(upgraded)).toEqual([['checked', 'service']])
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})

it('step 21 writes `checked` where the Agent SDK left `cli.claude` at the installed default', { timeout: 120_000 }, async () => {
  const upgraded = await PGlite.create()
  try {
    await upgraded.exec(fixture(20))
    await upgraded.exec("delete from setting_values where key = 'cli'")
    await upgraded.exec("delete from setting_definitions where key = 'cli'")
    await upgraded.exec(execution)
    await upgraded.exec(sdk)
    await step21(upgraded)
    expect(await claudeCli(upgraded)).toEqual([['checked', 'service']])
  } finally {
    await upgraded.close()
  }
})

it('config schema v22 writes `cli.claude: checked` for the Agent SDK of Claude, the other providers kept', () => {
  const raw = { version: 21, execution: { claude: 'sdk' }, cli: { claude: 'system', codex: 'system' }, projects: [] }
  const migrated = currentConfig(raw)
  expect(migrated).toEqual({ ...raw, version: SCHEMA_VERSION, cli: { claude: 'checked', codex: 'system' } })
  expect(currentConfig(migrated)).toEqual(migrated)
  expect(currentConfig({ version: 21, execution: { claude: 'sdk' }, projects: [] })).toEqual({ version: SCHEMA_VERSION, execution: { claude: 'sdk' }, cli: { claude: 'checked' }, projects: [] })
  expect(currentConfig({ version: 21, execution: { claude: 'auto' }, projects: [] })).toEqual({ version: SCHEMA_VERSION, execution: { claude: 'auto' }, projects: [] })
  expect(currentConfig({ version: SCHEMA_VERSION, execution: { claude: 'sdk' }, projects: [] })).toEqual({ version: SCHEMA_VERSION, execution: { claude: 'sdk' }, projects: [] })
})

it('step 21 leaves the installed CLI of another execution alone', { timeout: 120_000 }, async () => {
  const upgraded = await PGlite.create()
  try {
    await upgraded.exec(fixture(20))
    await upgraded.exec("update setting_values set value = '\"system\"', updated_by = 'page' where key = 'cli' and qualifier = 'claude'")
    await upgraded.exec(execution)
    await upgraded.exec(sdk.replace('"sdk"', '"auto"'))
    await step21(upgraded)
    expect(await claudeCli(upgraded)).toEqual([['system', 'page']])
  } finally {
    await upgraded.close()
  }
})
