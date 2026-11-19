import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { BuiltinStore } from '../builtin/store.js'
import { insertRows, rowsOf } from './copy.js'
import { ABC, fixture, readsWhole, schemaOf } from './database.fixture.js'
import { openDatabase, STEPS } from './database.js'

it('step 66 keeps the components of the built-in tracker, and the tasks before it have none', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 64))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(66))
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 66, 66)
    const store = new BuiltinStore(frozen)
    expect((await store.components(ABC)).map((each) => [each.name, each.description, each.open, each.total])).toEqual([
      ['Docs', '', 0, 0],
      ['Parser', 'Reading the input files.', 0, 1],
    ])
    expect((await store.get({ project: ABC, number: 1 }))?.component).toBe('Parser')
    expect((await store.get({ project: ABC, number: 2 }))?.component).toBeNull()
    expect((await store.history({ project: ABC, number: 1 })).at(-1)).toMatchObject({ field: 'component', from: null, to: 'Parser' })
    expect((await store.componentHistory('c0000000-0000-4000-8000-000000000001')).map((each) => [each.field, each.to])).toEqual([['created', 'Parser']])
    await insertRows(made, await rowsOf(frozen))
    expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    await upgraded.exec(fixture(65))
    await upgraded.exec(STEPS[63]!)
    expect(await new BuiltinStore(upgraded).components(ABC)).toEqual([])
    expect((await new BuiltinStore(upgraded).get({ project: ABC, number: 1 }))?.component).toBeNull()
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})
