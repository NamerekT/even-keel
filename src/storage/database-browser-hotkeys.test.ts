import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { loadBrowserHotkeys, saveBrowserHotkeys } from './browser-hotkeys.js'
import { fixture, readsWhole, schemaOf } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'

it('step 38 adds the hotkeys of each browser, none before it', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 36))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(38))
    expect(await databaseVersion(frozen)).toBe(38)
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 38, 38)
    expect(await loadBrowserHotkeys(frozen)).toEqual({ 'browser-example-0001': { chainRun: 'Mod+Shift+Enter' } })
    await upgraded.exec(fixture(37))
    await upgraded.exec(STEPS[35]!)
    expect(await loadBrowserHotkeys(upgraded)).toEqual({})
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})

it('a saved layout replaces the old one, an empty one goes back to the defaults', { timeout: 60_000 }, async () => {
  const db = await openDatabase(undefined)
  try {
    const at = new Date('2026-11-08T13:00:00.000Z')
    await saveBrowserHotkeys(db, 'browser-a-000001', { chainRun: 'F9' }, at)
    await saveBrowserHotkeys(db, 'browser-a-000001', { chainRun: 'Mod+Shift+Enter' }, at)
    await saveBrowserHotkeys(db, 'browser-b-000001', { chainRun: 'Alt+R' }, at)
    expect(await loadBrowserHotkeys(db)).toEqual({ 'browser-a-000001': { chainRun: 'Mod+Shift+Enter' }, 'browser-b-000001': { chainRun: 'Alt+R' } })
    await saveBrowserHotkeys(db, 'browser-a-000001', {}, at)
    expect(await loadBrowserHotkeys(db)).toEqual({ 'browser-b-000001': { chainRun: 'Alt+R' } })
  } finally {
    await db.close()
  }
})
