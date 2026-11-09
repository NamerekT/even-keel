import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { loadAccountSettings, saveAccountSettings } from '../account/settingsLayer.js'
import { insertRows, rowsOf } from './copy.js'
import { fixture, readsWhole, schemaOf } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'

it('step 41 adds what the transfer wrote into account folders and their own layers, none before it', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 39))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(41))
    expect(await databaseVersion(frozen)).toBe(41)
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 41, 41)
    expect(await loadAccountSettings(frozen)).toEqual(new Map([['john.doe', { written: { model: 'opus', theme: 'dark' }, own: { model: 'sonnet', statusLine: null } }]]))
    await insertRows(made, await rowsOf(frozen))
    expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    await upgraded.exec(fixture(40))
    await upgraded.exec(STEPS[38]!)
    expect(await loadAccountSettings(upgraded)).toEqual(new Map())
    await saveAccountSettings(upgraded, 'john.doe', { written: { model: 'opus' }, own: {} }, new Date('2026-11-09T01:00:00.000Z'))
    await saveAccountSettings(upgraded, 'john.doe', { written: { model: 'fable' }, own: { theme: 'light' } }, new Date('2026-11-09T02:00:00.000Z'))
    expect(await loadAccountSettings(upgraded)).toEqual(new Map([['john.doe', { written: { model: 'fable' }, own: { theme: 'light' } }]]))
    await saveAccountSettings(upgraded, 'john.doe', null, new Date())
    expect(await loadAccountSettings(upgraded)).toEqual(new Map())
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})
