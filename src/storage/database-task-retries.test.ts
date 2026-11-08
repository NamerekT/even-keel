import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { TaskRetries } from '../taskmcp/retries.js'
import { insertRows, rowsOf } from './copy.js'
import { ABC, fixture, readsWhole, schemaOf, XYZ } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'

it('step 39 adds retry progress, preserves older state and round trips the frozen sample', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 37))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(39))
    expect(await databaseVersion(frozen)).toBe(39)
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 39, 39)
    const journal = new TaskRetries(frozen)
    expect(await journal.run(ABC, 'batch-example', async ({ ids }) => ids)).toEqual(['ABC-4', 'ABC-5'])
    expect(await journal.run(XYZ, 'batch-example', async ({ ids }) => ids)).toEqual(['XYZ-8'])
    await insertRows(made, await rowsOf(frozen))
    expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    await new TaskRetries(made).run(ABC, 'next', async ({ ids, save }) => {
      ids.push('ABC-6')
      await save()
    })
    expect((await made.query('select * from task_retries')).rows).toHaveLength(3)
    await upgraded.exec(fixture(38))
    await upgraded.exec(STEPS[36]!)
    expect((await upgraded.query('select * from task_retries')).rows).toEqual([])
    await readsWhole(upgraded, 38, 38)
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})
