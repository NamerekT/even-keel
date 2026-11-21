import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { ImportRecords } from '../builtin/import-store.js'
import { BuiltinStore } from '../builtin/store.js'
import { insertRows, rowsOf } from './copy.js'
import { fixture, readsWhole, schemaOf } from './database.fixture.js'
import { openDatabase, STEPS } from './database.js'

const XYZ = '22222222-2222-4222-8222-222222222222'

it('step 71 keeps the name of a comment by another person and an import under way', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 69))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(71))
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 71, 71)
    const comments = await new BuiltinStore(frozen).comments({ project: XYZ, number: 7 })
    expect(comments.map((each) => [each.author, each.name])).toEqual([['person', 'Jane Doe']])
    const records = new ImportRecords(frozen)
    expect(await records.header(XYZ)).toMatchObject({ tracker: 'huly', key: 'XYZ', finishedAt: null, authors: [{ kind: 'person', name: 'Jane Doe', as: 'person' }, { kind: 'agent', as: 'agent' }] })
    expect((await records.rows(XYZ)).map((row) => [row.ref, row.number, row.stage, row.changes])).toEqual([
      ['huly-issue-7', 7, 'done', 2],
      ['huly-issue-8', 8, 'created', 0],
    ])
    await insertRows(made, await rowsOf(frozen))
    expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    await upgraded.exec(fixture(70))
    await upgraded.exec(STEPS[68]!)
    expect(await new ImportRecords(upgraded).header(XYZ)).toBeNull()
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})
