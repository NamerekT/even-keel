import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { databaseVersion, openDatabase, STEPS } from './database.js'
import { ABC, fixture, readsWhole, schemaOf, XYZ } from './database.fixture.js'
import { currentConfig } from './migrations.js'
import { SCHEMA_VERSION } from './schema.js'

const feedsOf = async (db: PGlite, project: string) =>
  JSON.parse((await db.query<{ feeds: string }>('select feeds from projects where id = $1', [project])).rows[0]!.feeds)

const rules = `
insert into setting_definitions (key, kind, spec, default_value, scopes) values
  ('chain.excludedLabels', 'list', '{}', '[]', 'global,project,profile'),
  ('chain.terminal', 'list', '{}', 'null', 'global,project,profile');
insert into setting_values (key, project_id, qualifier, value, updated_at, updated_by) values
  ('chain.excludedLabels', '${ABC}', '', '["Later"]', '2026-10-30T09:00:00.000Z', 'page'),
  ('chain.terminal', '${ABC}', '', 'null', '2026-10-30T09:00:00.000Z', 'page'),
  ('chain.excludedLabels', null, '', '["Never"]', '2026-10-30T09:00:00.000Z', 'page'),
  ('chain.excludedLabels', '${XYZ}', '', '["Other"]', '2026-10-30T09:00:00.000Z', 'page');
`

it('step 23 copies a project\'s own chain rules into each of its feeds', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined)
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(23))
    expect(await databaseVersion(frozen)).toBe(23)
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 23)
    expect((await feedsOf(frozen, ABC))[0].chain).toEqual({ excludedLabels: ['Later'] })
    await upgraded.exec(fixture(22))
    await upgraded.exec(rules)
    await upgraded.exec(STEPS.at(-1)!)
    expect(await feedsOf(upgraded, ABC)).toEqual([
      { id: '77777777-7777-4777-8777-777777777777', tracker: 'github', key: 'ABCGH', github: 'octo-org/ideas', chain: { excludedLabels: ['Later'], terminal: null } },
    ])
    expect(await feedsOf(upgraded, XYZ)).toEqual([])
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})

it('step 23 leaves the feeds of a project without rules of its own as they are', { timeout: 120_000 }, async () => {
  const db = await PGlite.create()
  try {
    await db.exec(fixture(22))
    const before = await feedsOf(db, ABC)
    await db.exec(STEPS.at(-1)!)
    expect(await feedsOf(db, ABC)).toEqual(before)
  } finally {
    await db.close()
  }
})

it('config schema v23 copies a project\'s own chain rules into each feed without its own', () => {
  const feed = { id: 'f1', tracker: 'github', key: 'ABCGH', github: 'octo-org/ideas' }
  const ruled = { ...feed, id: 'f2', chain: { requiredLabels: ['agent'] } }
  const raw = { version: 22, projects: [{ key: 'ABC', chain: { excludedLabels: ['Later'], brief: true }, feeds: [feed, ruled] }, { key: 'XYZ', feeds: [feed] }] }
  const migrated = currentConfig(raw)
  expect(migrated).toEqual({
    version: SCHEMA_VERSION,
    projects: [
      { key: 'ABC', chain: { excludedLabels: ['Later'], brief: true }, feeds: [{ ...feed, chain: { excludedLabels: ['Later'] } }, ruled] },
      { key: 'XYZ', feeds: [feed] },
    ],
  })
  expect(currentConfig(migrated)).toEqual(migrated)
  expect(currentConfig({ version: 22, projects: [{ key: 'ABC', chain: {}, feeds: [feed] }] })).toEqual({ version: SCHEMA_VERSION, projects: [{ key: 'ABC', chain: {}, feeds: [feed] }] })
})
