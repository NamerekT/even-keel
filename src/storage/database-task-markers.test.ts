import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { TaskRetries } from '../taskmcp/retries.js'
import { insertRows, rowsOf } from './copy.js'
import { ABC, fixture, readsWhole, schemaOf, XYZ } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'

it('step 40 adds the started position, preserves retry progress and round trips the frozen sample', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 38))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(40))
    expect(await databaseVersion(frozen)).toBe(40)
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 40, 40)
    const journal = new TaskRetries(frozen)
    expect(await journal.run(ABC, 'batch-example', async ({ ids, started }) => ({ ids, started }))).toEqual({
      ids: ['ABC-4', 'ABC-5'],
      started: { at: 2, marker: 'marker-example-0001' },
    })
    expect(await journal.run(XYZ, 'batch-example', async ({ started }) => started)).toBeNull()
    await insertRows(made, await rowsOf(frozen))
    expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    await upgraded.exec(fixture(39))
    await upgraded.exec(STEPS[37]!)
    expect(await new TaskRetries(upgraded).run(ABC, 'batch-example', async ({ ids, started }) => ({ ids, started }))).toEqual({
      ids: ['ABC-4', 'ABC-5'],
      started: null,
    })
    await readsWhole(upgraded, 39, 39)
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})
