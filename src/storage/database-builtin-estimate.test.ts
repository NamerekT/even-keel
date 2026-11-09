import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { BuiltinStore } from '../builtin/store.js'
import { insertRows, rowsOf } from './copy.js'
import { fixture, readsWhole, schemaOf } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'

const PROJECT = '11111111-1111-4111-8111-111111111111'

it('step 42 adds the estimate of a built-in task in minutes, none for the tasks before it', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 40))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(42))
    expect(await databaseVersion(frozen)).toBe(42)
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 42, 42)
    const store = new BuiltinStore(frozen)
    expect((await store.list([PROJECT])).map((task) => task.estimate)).toEqual([20, null])
    await insertRows(made, await rowsOf(frozen))
    expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    await upgraded.exec(fixture(41))
    await upgraded.exec(STEPS[39]!)
    expect((await new BuiltinStore(upgraded).list([PROJECT])).map((task) => task.estimate)).toEqual([null, null])
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})
