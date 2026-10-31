import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { readProfiles, saveProfiles } from '../profiles/store.js'
import { fixture, readsWhole, schemaOf } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'

it('step 24 gives each tracker profile its status moves, none on the profiles before it', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined)
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(24))
    expect(await databaseVersion(frozen)).toBe(24)
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 24)
    const { profiles } = await readProfiles(frozen)
    expect(profiles.map((profile) => profile.moves)).toEqual([{ start: 'In Progress', review: null, done: 'Shipped' }, undefined, undefined])
    await upgraded.exec(fixture(23))
    await upgraded.exec(STEPS[21]!)
    expect((await readProfiles(upgraded)).profiles.every((profile) => profile.moves === undefined)).toBe(true)
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})

it('a profile keeps its status moves through a save', { timeout: 120_000 }, async () => {
  const db = await openDatabase(undefined)
  try {
    const profile = { id: '33333333-3333-4333-8333-333333333333', kind: 'huly', name: 'Huly · example', values: {}, isDefault: true, login: null, expiresAt: null, moves: { start: null, done: 'Done' } }
    await saveProfiles(db, { profiles: [profile], links: {} })
    expect((await readProfiles(db)).profiles[0]?.moves).toEqual({ start: null, done: 'Done' })
  } finally {
    await db.close()
  }
})
