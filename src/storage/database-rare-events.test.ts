import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { loadRareEvents, pruneRareEvents, saveRareEvent } from '../sessions/rare.js'
import { fixture, readsWhole, schemaOf } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'

it('step 34 keeps the reported rare events and their open pairs, none before it', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 32))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(34))
    expect(await databaseVersion(frozen)).toBe(34)
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 34, 34)
    expect(await loadRareEvents(frozen)).toEqual([
      { entry: '46', event: 'job-end-1', sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', seenAt: Date.parse('2026-11-07T09:00:00.000Z') },
      {
        entry: '18', event: 'copy:old-session:1794045600000', sessionId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff', seenAt: Date.parse('2026-11-07T09:30:00.000Z'),
        waiting: {
          kind: 'transcript', old: 'old-session', since: 1794045600000,
          identity: { sessionId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff', cwd: 'C:\\repos\\example-project', task: 'ABC-2', project: 'ABC' },
        },
      },
      { entry: '86', event: 'boot', sessionId: 'cccccccc-dddd-4eee-8fff-000000000000', seenAt: Date.parse('2026-11-07T09:45:00.000Z'), waiting: { kind: 'answer' } },
    ])
    await upgraded.exec(fixture(33))
    await upgraded.exec(STEPS[31]!)
    expect(await loadRareEvents(upgraded)).toEqual([])
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})

it('a settled pair keeps its first time, and the old keys go', { timeout: 120_000 }, async () => {
  const db = await openDatabase(undefined)
  try {
    const seenAt = Date.parse('2026-11-07T10:00:00.000Z')
    await saveRareEvent(db, { entry: '86', event: 'boot', sessionId: 's1', seenAt, waiting: { kind: 'answer' } })
    await saveRareEvent(db, { entry: '86', event: 'boot', sessionId: 's1', seenAt: seenAt + 60_000 })
    await saveRareEvent(db, { entry: '46', event: 'turn-1', sessionId: 's2', seenAt: seenAt - 1 })
    expect(await loadRareEvents(db)).toEqual([
      { entry: '46', event: 'turn-1', sessionId: 's2', seenAt: seenAt - 1 },
      { entry: '86', event: 'boot', sessionId: 's1', seenAt },
    ])
    await pruneRareEvents(db, seenAt)
    expect(await loadRareEvents(db)).toEqual([{ entry: '86', event: 'boot', sessionId: 's1', seenAt }])
  } finally {
    await db.close()
  }
})
