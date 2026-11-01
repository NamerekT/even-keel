import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { loadSavedLimits, saveLimits } from '../limits/saved.js'
import { fixture, schemaOf } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'

it('step 25 keeps the last known limits of each account, none before it', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 23))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(25))
    expect(await databaseVersion(frozen)).toBe(25)
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    const saved = await loadSavedLimits(frozen)
    expect([...saved.keys()]).toEqual(['codex', 'global'])
    expect(saved.get('global')).toMatchObject({ source: 'usage', sevenDay: { usedPercentage: 69 }, updatedAt: '2026-10-31T03:05:00.000Z' })
    expect(saved.get('codex')).toMatchObject({ source: 'api', pool: 'chatgpt:example-account', fiveHour: null })
    await upgraded.exec(fixture(24))
    await upgraded.exec(STEPS[22]!)
    expect((await loadSavedLimits(upgraded)).size).toBe(0)
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})

it('an account keeps its limits through a save and loses them when forgotten', { timeout: 120_000 }, async () => {
  const db = await openDatabase(undefined)
  try {
    const limits = { fiveHour: null, sevenDay: { usedPercentage: 45, resetsAt: '2026-11-03T10:00:00.000Z' }, updatedAt: '2026-10-31T03:00:00.000Z', source: 'sdk' as const }
    await saveLimits(db, 'work', limits)
    await saveLimits(db, 'work', { ...limits, sevenDay: { ...limits.sevenDay, usedPercentage: 46 } })
    expect((await loadSavedLimits(db)).get('work')?.sevenDay?.usedPercentage).toBe(46)
    await saveLimits(db, 'work', undefined)
    expect((await loadSavedLimits(db)).size).toBe(0)
  } finally {
    await db.close()
  }
})
