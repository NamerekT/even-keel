import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { ImportRecords } from '../builtin/import-store.js'
import { insertRows, rowsOf } from './copy.js'
import { fixture, readsWhole, schemaOf, XYZ } from './database.fixture.js'
import { openDatabase, STEPS } from './database.js'

it("step 74 keeps what the import's last check saw of each task; a row of an older database saw nothing (BTN-1432)", { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 72))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(74))
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 74, 74)
    expect((await new ImportRecords(frozen).rows(XYZ)).map((row) => [row.ref, row.seen])).toEqual([
      ['huly-issue-7', { at: 1795600000000, comments: 1, changes: 2, files: 1 }],
      ['huly-issue-8', null],
    ])
    await insertRows(made, await rowsOf(frozen))
    expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    await upgraded.exec(fixture(73))
    await upgraded.exec(STEPS[71]!)
    expect((await new ImportRecords(upgraded).rows(XYZ)).map((row) => row.seen)).toEqual([null, null])
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})
