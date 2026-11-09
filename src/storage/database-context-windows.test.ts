import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { CONTEXT_WINDOWS_KEPT, loadContextWindows, loadSessionWindows, saveContextWindow, saveSessionWindow, SESSION_WINDOWS_KEPT } from './context-windows.js'
import { insertRows, rowsOf } from './copy.js'
import { fixture, readsWhole, schemaOf } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'

const STAMP = '["claude",1794700000000,1794600000000]'

it('step 44 adds the context windows the agents named, none before it', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 42))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(44))
    expect(await databaseVersion(frozen)).toBe(44)
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 44, 44)
    expect(await loadContextWindows(frozen)).toEqual([
      { account: 'john.doe', model: 'opus', settings: '{"autoCompactWindow":250000}', stamp: STAMP, window: 250_000, measuredAt: 1794714000000 },
      { account: 'john.doe', model: 'opus', settings: null, stamp: STAMP, window: 200_000, measuredAt: 1794714100000 },
    ])
    expect(await loadSessionWindows(frozen)).toEqual([['00000000-0000-4000-8000-000000000001', 250_000]])
    await insertRows(made, await rowsOf(frozen))
    expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    await upgraded.exec(fixture(43))
    await upgraded.exec(STEPS[41]!)
    expect(await loadContextWindows(upgraded)).toEqual([])
    expect(await loadSessionWindows(upgraded)).toEqual([])
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})

it('a new answer replaces the one of the same launch, settings or none, and only the newest are kept', { timeout: 60_000 }, async () => {
  const db = await openDatabase(undefined)
  try {
    const none = { account: 'john.doe', model: 'opus', settings: null, stamp: 'v1', window: 200_000, measuredAt: 1 }
    await saveContextWindow(db, none)
    await saveContextWindow(db, { ...none, settings: '{}', window: 250_000, measuredAt: 2 })
    await saveContextWindow(db, { ...none, stamp: 'v2', window: null, measuredAt: 3 })
    expect(await loadContextWindows(db)).toEqual([
      { ...none, settings: '{}', window: 250_000, measuredAt: 2 },
      { ...none, stamp: 'v2', window: null, measuredAt: 3 },
    ])
    for (let at = 10; at < 10 + CONTEXT_WINDOWS_KEPT; at++) await saveContextWindow(db, { ...none, model: `m${at}`, measuredAt: at })
    const kept = await loadContextWindows(db)
    expect(kept).toHaveLength(CONTEXT_WINDOWS_KEPT)
    expect(kept[0]!.model).toBe('m10')
  } finally {
    await db.close()
  }
})

it('a session keeps its last window, the oldest sessions go past the limit', { timeout: 60_000 }, async () => {
  const db = await openDatabase(undefined)
  try {
    await saveSessionWindow(db, 'first', 200_000, 1)
    await saveSessionWindow(db, 'first', 250_000, 5)
    await saveSessionWindow(db, 'second', 400_000, 2)
    expect(await loadSessionWindows(db)).toEqual([['first', 250_000], ['second', 400_000]])
    await db.exec(`insert into session_windows (session_id, window_size, seen_at)
      select 's' || n, 1, 10 + n from generate_series(1, ${SESSION_WINDOWS_KEPT}) as n`)
    await saveSessionWindow(db, 'last', 1, 10_000)
    const kept = await loadSessionWindows(db)
    expect(kept).toHaveLength(SESSION_WINDOWS_KEPT)
    expect(kept.map(([id]) => id)).not.toContain('first')
    expect(kept.at(-1)).toEqual(['last', 1])
  } finally {
    await db.close()
  }
})
