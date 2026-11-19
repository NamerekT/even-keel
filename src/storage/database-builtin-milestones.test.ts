import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { BuiltinStore } from '../builtin/store.js'
import { insertRows, rowsOf } from './copy.js'
import { ABC, fixture, readsWhole, schemaOf } from './database.fixture.js'
import { openDatabase, STEPS } from './database.js'

it('step 67 keeps the milestones\' description, status and times, and those made before it are planned since their creation', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 65))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(67))
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 67, 67)
    const fields = (rows: Awaited<ReturnType<BuiltinStore['milestoneList']>>) =>
      rows.map((each) => [each.name, each.description, each.status, each.closedAt, each.createdAt])
    expect(fields(await new BuiltinStore(frozen).milestoneList(ABC))).toEqual([
      ['v0.2', '', 'completed', '2026-11-05T18:00:00.000Z', '2026-11-01T08:00:00.000Z'],
      ['v0.3', 'The parser reads both formats.', 'active', null, '2026-11-06T08:55:00.000Z'],
    ])
    await insertRows(made, await rowsOf(frozen))
    expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    await upgraded.exec(fixture(66))
    await upgraded.exec(STEPS[64]!)
    expect(fields(await new BuiltinStore(upgraded).milestoneList(ABC))).toEqual([['v0.3', '', 'planned', null, '2026-11-06T08:55:00.000Z']])
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})
