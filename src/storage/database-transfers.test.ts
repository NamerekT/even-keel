import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { ExportRecords } from '../builtin/export-store.js'
import { TransferReports } from '../builtin/transfer-store.js'
import { insertRows, rowsOf } from './copy.js'
import { ABC, fixture, readsWhole, schemaOf, XYZ } from './database.fixture.js'
import { openDatabase, STEPS } from './database.js'

it("step 69 keeps a running export's direction, plan and check and the reports of finished transfers", { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 67))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(69))
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 69, 69)
    await insertRows(made, await rowsOf(frozen))
    expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    await frozen.exec(STEPS[69]!) // step 72's column, read by today's header
    const header = await new ExportRecords(frozen).header(ABC)
    expect(header?.plan?.losses).toEqual([{ kind: 'estimate', tasks: ['ABC-1'], names: [] }])
    expect(header?.checked?.rows.find((row) => row.kind === 'comments')).toEqual({ kind: 'comments', source: 2, target: 1, tasks: ['ABC-1'] })
    const reports = new TransferReports(frozen)
    expect(await reports.list(XYZ)).toEqual([{ id: 'transfer-aaaaaaaaaaaa', direction: 'export', tracker: 'github', switchedAt: '2026-11-10T08:25:00.000Z', matched: true, tasks: 1 }])
    expect((await reports.read('transfer-aaaaaaaaaaaa'))?.sourceKey).toBe('XYZ')
    await upgraded.exec(fixture(68))
    await upgraded.exec(STEPS[66]!)
    await upgraded.exec(STEPS[69]!)
    const old = await new ExportRecords(upgraded).header(ABC)
    expect([old?.plan, old?.checked]).toEqual([null, null])
    expect((await upgraded.query<{ direction: string }>('select direction from tracker_exports')).rows).toEqual([{ direction: 'export' }])
    expect(await new TransferReports(upgraded).list(XYZ)).toEqual([])
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})
