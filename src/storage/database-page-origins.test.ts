import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { PageOrigins } from '../access/origins.js'
import { insertRows, rowsOf } from './copy.js'
import { fixture, readsWhole, schemaOf } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'

it('step 84 keeps the outside addresses of the page, none before it (BTN-1661)', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 82))
  const upgraded = await PGlite.create()
  const clock = () => new Date('2026-11-25T09:00:00.000Z')
  try {
    await frozen.exec(fixture(84))
    expect(await databaseVersion(frozen)).toBe(84)
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 84, 84)
    expect((await PageOrigins.load(frozen, { clock })).list().map((each) => each.origin)).toEqual(['https://hub.example.com', 'http://192.0.2.10:4747'])
    await insertRows(made, await rowsOf(frozen))
    expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    await upgraded.exec(fixture(83))
    await upgraded.exec(STEPS[81]!)
    expect(await schemaOf(upgraded)).toEqual(await schemaOf(made))
    expect((await PageOrigins.load(upgraded, { clock })).list()).toEqual([])
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})
