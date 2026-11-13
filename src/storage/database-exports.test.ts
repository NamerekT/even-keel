import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { exportRows } from '../builtin/export-store.js'
import { insertRows, rowsOf } from './copy.js'
import { ABC, fixture, readsWhole, schemaOf } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'

const STEP = STEPS[46]!

describe('step 49: the copy of built-in tasks into another tracker (BTN-1073)', { timeout: 120_000 }, () => {
  it('makes the tables of the frozen sample and reads its rows', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 47))
    try {
      await frozen.exec(fixture(49))
      expect(await databaseVersion(frozen)).toBe(49)
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
      await readsWhole(frozen, 49, 49)
      expect(await exportRows(frozen, ABC)).toEqual([
        {
          ref: 't0000000-0000-4000-8000-000000000002',
          number: 2,
          key: 'GH-14',
          url: 'https://github.example.com/example/repo/issues/14',
          stage: 'journaled',
          marker: 'even-keel:ABC-2',
          done: 0,
        },
        { ref: 't0000000-0000-4000-8000-000000000003', number: 3, key: null, url: null, stage: 'pending', marker: null, done: 0 },
      ])
      await insertRows(made, await rowsOf(frozen))
      expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    } finally {
      await Promise.all([frozen.close(), made.close()])
    }
  })

  it('adds the empty tables over the sample of step 48', async () => {
    const db = await PGlite.create()
    try {
      await db.exec(fixture(48))
      await db.exec(STEP)
      expect(await exportRows(db, ABC)).toEqual([])
      expect((await db.query('select * from tracker_exports')).rows).toEqual([])
    } finally {
      await db.close()
    }
  })
})
