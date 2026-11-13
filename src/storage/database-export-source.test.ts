import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { ExportRecords } from '../builtin/export-store.js'
import { insertRows, rowsOf } from './copy.js'
import { ABC, fixture, readsWhole, schemaOf } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'

const STEP = STEPS[47]!

const sourceKey = async (db: PGlite): Promise<string | null | undefined> =>
  (await db.query<{ source_key: string | null }>('select source_key from tracker_exports where project_id = $1', [ABC])).rows[0]?.source_key

describe("step 50: the copied project's old key (BTN-1076)", { timeout: 120_000 }, () => {
  it('makes the table of the frozen sample and reads its rows', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 48))
    try {
      await frozen.exec(fixture(50))
      expect(await databaseVersion(frozen)).toBe(50)
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
      await readsWhole(frozen, 50, 50)
      expect(await sourceKey(frozen)).toBe('ABC')
      await insertRows(made, await rowsOf(frozen))
      expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    } finally {
      await Promise.all([frozen.close(), made.close()])
    }
  })

  it('gives the copy of a project still on the built-in tracker its key, and none to one that left it', async () => {
    for (const [tracker, expected] of [['"builtin"', 'ABC'], ['"huly"', null]] as const) {
      const db = await PGlite.create()
      try {
        await db.exec(fixture(49))
        await db.query(`update setting_values set value = $2 where key = 'tracker' and project_id = $1 and qualifier = ''`, [ABC, tracker])
        await db.exec(STEP)
        expect(await sourceKey(db)).toBe(expected)
      } finally {
        await db.close()
      }
    }
  })

  it("keeps the project's key at the start of a copy", async () => {
    const db = await PGlite.create()
    try {
      await db.exec(fixture(50))
      await db.query('delete from tracker_exports')
      await new ExportRecords(db).begin(ABC, { profile: 'github-example', place: 'example/repo', key: 'GH' })
      expect(await sourceKey(db)).toBe('ABC')
    } finally {
      await db.close()
    }
  })
})
