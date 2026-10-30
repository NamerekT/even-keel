import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { databaseVersion, openDatabase, STEPS } from './database.js'
import { ABC, fixture, readsWhole, schemaOf } from './database.fixture.js'
import { currentConfig } from './migrations.js'
import { SCHEMA_VERSION } from './schema.js'

const TRACKERS = ['deleteHuly', 'deleteGithub', 'deleteGitlab', 'deleteLinear', 'deleteJira']

it('step 19 splits the tracker group of Protection into a group per tracker, the rest of the value kept', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined)
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(19))
    expect(await databaseVersion(frozen)).toBe(19)
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 19)
    await upgraded.exec(fixture(18))
    await upgraded.exec("insert into setting_definitions (key, kind, spec, default_value, scopes) values ('protection', 'json', '{}', '{}', 'global,project')")
    await upgraded.query("insert into setting_values (key, project_id, qualifier, value, updated_at, updated_by) values ('protection', null, '', $1, '2026-10-01', 'hand'), ('protection', $2, '', $3, '2026-10-02', 'page')", [
      '{"disabled":["forcePush","deleteTracker"],"claude":["Write(.env)"]}',
      ABC,
      '{"claude":["mcp__x__deleteTracker"]}',
    ])
    await upgraded.exec(STEPS.at(-1)!)
    const { rows } = await upgraded.query<{ value: string; updated_at: string; updated_by: string }>("select value, updated_at, updated_by from setting_values where key = 'protection' order by updated_at")
    expect(rows.map((row) => JSON.parse(row.value))).toEqual([{ disabled: ['forcePush', ...TRACKERS], claude: ['Write(.env)'] }, { claude: ['mcp__x__deleteTracker'] }])
    expect(rows.map((row) => [row.updated_at, row.updated_by])).toEqual([['2026-10-01', 'hand'], ['2026-10-02', 'page']])
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})

it('config schema v20 splits the tracker group the same way, at both levels', () => {
  const raw = { version: 19, protection: { disabled: ['deleteTracker', 'mirrorPush'] }, projects: [{ id: 'p', key: 'ABC', tracker: 'huly', repo: 'C:/example', protection: { disabled: ['deleteTracker'], claude: [] } }, { id: 'q', key: 'XYZ', tracker: 'huly', repo: 'C:/other' }] }
  const migrated = currentConfig(raw)
  expect(migrated).toEqual({ ...raw, version: SCHEMA_VERSION, protection: { disabled: [...TRACKERS, 'mirrorPush'] }, projects: [{ ...raw.projects[0], protection: { disabled: TRACKERS, claude: [] } }, raw.projects[1]] })
  expect(currentConfig(migrated)).toEqual(migrated)
})
