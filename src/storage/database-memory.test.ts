import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { forgetProjectRows } from '../chain/store.js'
import { insertRows, rowsOf } from './copy.js'
import { ABC, fixture, readsWhole, schemaOf } from './database.fixture.js'
import { openDatabase, STEPS, type Queryable } from './database.js'

type Row = { name: string; version: number; file: string | null; deleted: boolean }

/** The table's rows of the project; the service no longer writes it (BTN-1646), the step stays. */
async function memoryRows(db: Queryable, project: string): Promise<Row[]> {
  return (await db.query<Row>('select name, version, file, deleted from memory_records where project_id = $1 order by name', [project])).rows
}

describe('step 54: the project memory (BTN-1029)', { timeout: 120_000 }, () => {
  it('makes the table of the frozen sample and reads its rows', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 52))
    try {
      await frozen.exec(fixture(54))
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
      await readsWhole(frozen, 54, 54)
      expect(await memoryRows(frozen, ABC)).toEqual([
        { name: 'old-lexer-flag', version: 2, file: null, deleted: true },
        { name: 'parser-needs-utf8', version: 3, file: 'parser-needs-utf8.md', deleted: false },
      ])
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
      expect(await memoryRows(db, ABC)).toEqual([])
      await db.query(`insert into memory_records (project_id, name, description, type, body, version, at) values ($1, 'a', 'b', 'project', 'c', 1, 'now')`, [ABC])
      // `forgetProjectRows` clears every table of the current schema, the moves of step 57 among them.
      for (const step of STEPS.slice(52)) await db.exec(step)
      await forgetProjectRows(db, ABC)
      expect(await memoryRows(db, ABC)).toEqual([])
    } finally {
      await db.close()
    }
  })
})
