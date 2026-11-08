import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { readProfiles, saveProfiles } from '../profiles/store.js'
import { fixture, readsWhole, schemaOf } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'

it('step 36 keeps a turned-off profile, every profile on before it', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 34))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(36))
    expect(await databaseVersion(frozen)).toBe(36)
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 36, 36)
    expect((await readProfiles(frozen)).profiles.map((profile) => profile.disabled)).toEqual([undefined, true, undefined])
    await upgraded.exec(fixture(35))
    await upgraded.exec(STEPS[33]!)
    expect((await readProfiles(upgraded)).profiles.map((profile) => profile.disabled)).toEqual([undefined, undefined, undefined])
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})

it('a turned-off profile is saved and read back, and turned on again', { timeout: 120_000 }, async () => {
  const db = await openDatabase(undefined)
  try {
    const profile = { id: 'p1', kind: 'gitlab', name: 'GitLab · example', values: {}, isDefault: true, login: null, expiresAt: null }
    await saveProfiles(db, { profiles: [{ ...profile, disabled: true }], links: {} })
    expect((await readProfiles(db)).profiles[0]?.disabled).toBe(true)
    await saveProfiles(db, { profiles: [profile], links: {} })
    expect((await readProfiles(db)).profiles[0]?.disabled).toBeUndefined()
  } finally {
    await db.close()
  }
})
