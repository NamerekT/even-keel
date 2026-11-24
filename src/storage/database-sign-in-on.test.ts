import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { signInOnSince } from '../access/store.js'
import { insertRows, rowsOf } from './copy.js'
import { fixture, readsWhole, schemaOf } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'

it('step 83 keeps the mark that an invitation turned the sign-in on, none before it (BTN-1656)', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 81))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(83))
    expect(await databaseVersion(frozen)).toBe(83)
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 83, 83)
    expect(await signInOnSince(frozen)).toBe('2026-11-24T09:30:00.000Z')
    await insertRows(made, await rowsOf(frozen))
    expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    await upgraded.exec(fixture(82))
    await upgraded.exec(STEPS[80]!)
    expect(await schemaOf(upgraded)).toEqual(await schemaOf(made))
    expect(await signInOnSince(upgraded)).toBeNull()
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})
