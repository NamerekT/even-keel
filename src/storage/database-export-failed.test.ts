import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { ExportRecords } from '../builtin/export-store.js'
import { insertRows, rowsOf } from './copy.js'
import { ABC, fixture, readsWhole, schemaOf } from './database.fixture.js'
import { openDatabase, STEPS } from './database.js'

it('step 73 keeps why the copy stopped; a copy of an older database stopped for no reason it knows (BTN-1190)', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 71))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(73))
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 73, 73)
    expect(await new ExportRecords(frozen).header(ABC)).toMatchObject({ key: 'GH', failed: { code: 'export.failed', params: { tracker: 'GitHub' }, detail: 'github: HTTP 502' } })
    await insertRows(made, await rowsOf(frozen))
    expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    await upgraded.exec(fixture(72))
    await upgraded.exec(STEPS[70]!)
    expect(await new ExportRecords(upgraded).header(ABC)).toMatchObject({ key: 'GH', closed: true, failed: null })
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})
