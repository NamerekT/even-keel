import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { loadManagementKeys } from '../account/management.js'
import { fixture, readsWhole, schemaOf } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'

it('step 37 adds the management keys of OpenRouter accounts, none before it', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 35))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(37))
    expect(await databaseVersion(frozen)).toBe(37)
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 37, 37)
    expect(await loadManagementKeys(frozen)).toEqual(new Map([['opencode-example', 'sk-or-v1-management-example']]))
    await upgraded.exec(fixture(36))
    await upgraded.exec(STEPS[34]!)
    expect(await loadManagementKeys(upgraded)).toEqual(new Map())
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})
