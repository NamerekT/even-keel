import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { insertRows, rowsOf } from './copy.js'
import { fixture, readsWhole, schemaOf } from './database.fixture.js'
import { openDatabase, STEPS } from './database.js'

const LAPTOP = '99999999-9999-4999-8999-999999999999'

describe("step 58: a pool machine's own folder of the project (BTN-1271)", { timeout: 120_000 }, () => {
  it('adds the column of the frozen sample and reads its rows', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 56))
    try {
      await frozen.exec(fixture(58))
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
      await readsWhole(frozen, 58, 58)
      const { rows } = await frozen.query<{ folder: string | null; enabled: boolean }>('select folder, enabled from project_machines where machine_id = $1', [LAPTOP])
      expect(rows).toEqual([{ folder: '/home/example/work/abc', enabled: false }])
      await insertRows(made, await rowsOf(frozen))
      expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    } finally {
      await Promise.all([frozen.close(), made.close()])
    }
  })

  it('leaves the rows of a database before it without a folder of their own', async () => {
    const db = await PGlite.create()
    try {
      await db.exec(fixture(57))
      await db.exec(STEPS[55]!)
      const { rows } = await db.query<{ folder: string | null }>('select folder from project_machines')
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.every((row) => row.folder === null)).toBe(true)
    } finally {
      await db.close()
    }
  })
})
