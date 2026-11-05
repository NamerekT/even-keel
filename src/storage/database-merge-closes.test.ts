import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { loadMergeMarks, saveMergeMark } from '../tracker/closes.js'
import { ABC, FEED, fixture, readsWhole, schemaOf } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'

it('step 26 keeps the tasks the merge closer closed with the commits main had, none before it', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined)
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(26))
    expect(await databaseVersion(frozen)).toBe(26)
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 26, 26)
    expect(await loadMergeMarks(frozen)).toEqual([
      { project: ABC, task: 'ABC-1', commits: ['1111111111111111111111111111111111111111'], closedAt: '2026-11-01T14:35:47.000Z' },
      { project: FEED, task: 'ABCGH-4', commits: ['2222222222222222222222222222222222222222', '3333333333333333333333333333333333333333'], closedAt: '2026-11-01T15:00:00.000Z' },
    ])
    await upgraded.exec(fixture(25))
    await upgraded.exec(STEPS[23]!)
    expect(await loadMergeMarks(upgraded)).toEqual([])
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})

it('a close is kept through a save, and a later close of the same task replaces it', { timeout: 120_000 }, async () => {
  const db = await openDatabase(undefined)
  try {
    await saveMergeMark(db, { project: ABC, task: 'ABC-7', commits: ['early'], closedAt: '2026-11-01T14:35:47.000Z' })
    await saveMergeMark(db, { project: ABC, task: 'ABC-7', commits: ['later'], closedAt: '2026-11-01T17:00:00.000Z' })
    expect(await loadMergeMarks(db)).toEqual([{ project: ABC, task: 'ABC-7', commits: ['later'], closedAt: '2026-11-01T17:00:00.000Z' }])
  } finally {
    await db.close()
  }
})
