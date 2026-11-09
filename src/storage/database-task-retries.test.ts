import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
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
    // The journal's code reads the newest schema: a v39 database is read by SQL.
    const ids = async (project: string) =>
      JSON.parse((await frozen.query<{ ids: string }>("select ids from task_retries where project_id = $1 and retry_key = 'batch-example'", [project])).rows[0]!.ids)
    expect(await ids(ABC)).toEqual(['ABC-4', 'ABC-5'])
    expect(await ids(XYZ)).toEqual(['XYZ-8'])
    await insertRows(made, await rowsOf(frozen))
    expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    await made.query(`insert into task_retries (project_id, retry_key, ids) values ($1, 'next', '["ABC-6"]')`, [ABC])
    expect((await made.query('select * from task_retries')).rows).toHaveLength(3)
    await upgraded.exec(fixture(38))
    await upgraded.exec(STEPS[36]!)
    expect((await upgraded.query('select * from task_retries')).rows).toEqual([])
    await readsWhole(upgraded, 38, 38)
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})
