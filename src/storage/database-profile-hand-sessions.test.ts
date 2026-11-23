import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { readProfiles, saveProfiles } from '../profiles/store.js'
import { fixture, readsWhole, schemaOf } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'

it('step 76 keeps a profile from sessions started by hand, every profile given to them before it (BTN-1498)', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 74))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(76))
    expect(await databaseVersion(frozen)).toBe(76)
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 76, 76)
    expect((await readProfiles(frozen)).profiles.map((profile) => profile.handSessions)).toEqual([false, undefined, undefined])
    await upgraded.exec(fixture(75))
    await upgraded.exec(STEPS[73]!)
    expect(await schemaOf(upgraded)).toEqual(await schemaOf(made))
    expect((await readProfiles(upgraded)).profiles.map((profile) => profile.handSessions)).toEqual([undefined, undefined, undefined])
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})

it('a profile kept from sessions started by hand is saved and read back, and given to them again', { timeout: 120_000 }, async () => {
  const db = await openDatabase(undefined)
  try {
    const profile = { id: 'p1', kind: 'gitlab', name: 'GitLab · example', values: {}, isDefault: true, login: null, expiresAt: null }
    await saveProfiles(db, { profiles: [{ ...profile, handSessions: false }], links: {} })
    expect((await readProfiles(db)).profiles[0]?.handSessions).toBe(false)
    await saveProfiles(db, { profiles: [profile], links: {} })
    expect((await readProfiles(db)).profiles[0]?.handSessions).toBeUndefined()
  } finally {
    await db.close()
  }
})
