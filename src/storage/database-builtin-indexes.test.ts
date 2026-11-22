import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { insertRows, rowsOf } from './copy.js'
import { fixture, readsWhole, schemaOf } from './database.fixture.js'
import { openDatabase, STEPS } from './database.js'

it("step 75 indexes a built-in task's parent and a relation's target; a database of step 74 gains both (BTN-1474)", { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 73))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(75))
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 75, 75)
    const indexes = await made.query<{ indexname: string; indexdef: string }>(
      "select indexname, indexdef from pg_indexes where indexname in ('builtin_tasks_parent', 'builtin_relations_to') order by indexname",
    )
    expect(indexes.rows.map((row) => row.indexdef.replace(/^.* USING /, ''))).toEqual(['btree (to_id)', 'btree (parent_id)'])
    await insertRows(made, await rowsOf(frozen))
    expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    await upgraded.exec(fixture(74))
    await upgraded.exec(STEPS[72]!)
    expect(await schemaOf(upgraded)).toEqual(await schemaOf(made))
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})
