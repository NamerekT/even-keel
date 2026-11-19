import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { BuiltinStore } from '../builtin/store.js'
import { insertRows, rowsOf } from './copy.js'
import { ABC, fixture, readsWhole, schemaOf } from './database.fixture.js'
import { openDatabase, STEPS } from './database.js'

it('step 65 keeps the change history of the built-in tracker, and the tasks before it have none', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 63))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(65))
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 65, 65)
    const store = new BuiltinStore(frozen)
    expect((await store.history({ project: ABC, number: 1 })).map((each) => [each.by, each.model, each.field, each.from, each.to])).toEqual([
      ['person', null, 'created', null, null],
      ['service', null, 'status', 'Todo', 'In Progress'],
      ['agent', 'Claude | opus', 'description', null, null],
      ['service', null, 'status', 'In Progress', 'Done'],
    ])
    expect((await store.history({ project: ABC, number: 1 }))[2]?.diff).toEqual([{ kind: 'removed', text: 'Read the file.' }, { kind: 'added', text: 'Read the sample file.' }])
    expect((await store.milestoneHistory('m0000000-0000-4000-8000-000000000001')).map((each) => each.field)).toEqual(['created', 'date'])
    await insertRows(made, await rowsOf(frozen))
    expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    await upgraded.exec(fixture(64))
    await upgraded.exec(STEPS[62]!)
    expect(await new BuiltinStore(upgraded).history({ project: ABC, number: 1 })).toEqual([])
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})
