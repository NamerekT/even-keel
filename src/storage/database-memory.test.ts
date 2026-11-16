import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { forgetProjectRows } from '../chain/store.js'
import { memoryRecord, memoryRecords } from '../memory/store.js'
import { insertRows, rowsOf } from './copy.js'
import { ABC, fixture, readsWhole, schemaOf } from './database.fixture.js'
import { openDatabase, STEPS } from './database.js'

describe('step 54: the project memory (BTN-1029)', { timeout: 120_000 }, () => {
  it('makes the table of the frozen sample and reads its rows', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 52))
    try {
      await frozen.exec(fixture(54))
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
      await readsWhole(frozen, 54, 54)
      expect((await memoryRecords(frozen, ABC)).map((record) => [record.name, record.version, record.file])).toEqual([['parser-needs-utf8', 3, 'parser-needs-utf8.md']])
      expect(await memoryRecord(frozen, ABC, 'old-lexer-flag')).toMatchObject({ deleted: true, version: 2 })
      await insertRows(made, await rowsOf(frozen))
      expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    } finally {
      await Promise.all([frozen.close(), made.close()])
    }
  })

  it('takes the sample of the step before, and forgets a removed project', async () => {
    const db = await PGlite.create()
    try {
      await db.exec(fixture(53))
      await db.exec(STEPS[51]!)
      expect(await memoryRecords(db, ABC)).toEqual([])
      await db.query(`insert into memory_records (project_id, name, description, type, body, version, at) values ($1, 'a', 'b', 'project', 'c', 1, 'now')`, [ABC])
      await forgetProjectRows(db, ABC)
      expect(await memoryRecords(db, ABC, true)).toEqual([])
    } finally {
      await db.close()
    }
  })
})
