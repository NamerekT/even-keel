import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { ExportRecords } from '../builtin/export-store.js'
import { insertRows, rowsOf } from './copy.js'
import { ABC, fixture, readsWhole, schemaOf } from './database.fixture.js'
import { openDatabase, STEPS } from './database.js'

it('step 72 keeps whether the copy takes the closed tasks too; a copy begun before takes the open ones (BTN-1289)', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 70))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(72))
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 72, 72)
    await insertRows(made, await rowsOf(frozen))
    expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    await frozen.exec(STEPS[70]!) // step 73's column, read by today's header
    expect(await new ExportRecords(frozen).header(ABC)).toMatchObject({ key: 'GH', closed: true, history: false })
    await upgraded.exec(fixture(71))
    await upgraded.exec(STEPS[69]! + STEPS[70]!)
    expect(await new ExportRecords(upgraded).header(ABC)).toMatchObject({ key: 'GH', closed: false })
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})
