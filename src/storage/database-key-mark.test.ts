import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { tokensOf } from '../access/store.js'
import { insertRows, rowsOf } from './copy.js'
import { fixture, readsWhole, schemaOf } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'

const OWNER = 'a1000000-0000-4000-8000-000000000001'

it('step 80 marks a device token signed in with the owner key, none before it (BTN-1619)', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 78))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(80))
    expect(await databaseVersion(frozen)).toBe(80)
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 80, 80)
    expect((await tokensOf(frozen, OWNER)).map((token) => [token.device, token.keyMark])).toEqual([
      ['Firefox on Linux', '3f1c9a7e5b2d8f4a6c0e1b3d5f7a9c2e4b6d8f0a1c3e5b7d9f2a4c6e8b0d1f3a'],
      ['Safari on iPhone', null],
    ])
    await insertRows(made, await rowsOf(frozen))
    expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    await upgraded.exec(fixture(79))
    await upgraded.exec(STEPS[77]!)
    expect(await schemaOf(upgraded)).toEqual(await schemaOf(made))
    expect((await tokensOf(upgraded, OWNER)).map((token) => token.keyMark)).toEqual([null, null])
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})
