import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { loadEventLog, pruneEventLog, saveEventEntry, saveEventMemory } from '../event-log/log.js'
import { notice } from '../notice/notice.js'
import { ABC, fixture, readsWhole, schemaOf } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'

it('step 29 keeps the event log and what it remembers, nothing before it', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 27))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(29))
    expect(await databaseVersion(frozen)).toBe(29)
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 29, 29)
    const { entries, memory } = await loadEventLog(frozen)
    expect(entries.map((entry) => [entry.id, entry.level, entry.notice.code, entry.place?.view ?? null])).toEqual([
      ['1', 'info', 'eventLog.chainStarted', 'project'],
      ['2', 'error', 'eventLog.red', 'ci'],
      ['3', 'warning', 'text', null],
    ])
    expect(memory?.chains).toEqual({ [ABC]: { paused: false, error: null } })
    await upgraded.exec(fixture(28))
    await upgraded.exec(STEPS[26]!)
    expect(await loadEventLog(upgraded)).toEqual({ entries: [], memory: null })
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})

it('an entry is kept through a save, the older ones go on a prune, and the memory is replaced', { timeout: 120_000 }, async () => {
  const db = await openDatabase(undefined)
  try {
    for (const id of ['1', '2', '3']) {
      await saveEventEntry(db, { id, at: '2026-11-05T12:00:00.000Z', level: 'info', notice: notice('eventLog.launch', { task: `ABC-${id}` }), place: { view: 'task', project: ABC, task: `ABC-${id}` } })
    }
    await pruneEventLog(db, '2')
    await saveEventMemory(db, { seen: { a: '2026-11-05T12:00:00.000Z' }, chains: {} })
    await saveEventMemory(db, { seen: {}, chains: { [ABC]: { paused: true, error: null } } })
    const { entries, memory } = await loadEventLog(db)
    expect(entries.map((entry) => entry.id)).toEqual(['2', '3'])
    expect(entries[0]!.place).toEqual({ view: 'task', project: ABC, task: 'ABC-2' })
    expect(memory).toEqual({ seen: {}, chains: { [ABC]: { paused: true, error: null } } })
  } finally {
    await db.close()
  }
})
