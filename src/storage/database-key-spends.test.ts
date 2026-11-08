import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { readKeySpends, saveKeySpend } from '../account/spend.js'
import { fixture, readsWhole, schemaOf } from './database.fixture.js'
import { databaseVersion, openDatabase, STEPS } from './database.js'

it('step 35 keeps the real spend of sessions on a key, none before it', { timeout: 120_000 }, async () => {
  const frozen = await PGlite.create()
  const made = await openDatabase(undefined, STEPS.slice(0, 33))
  const upgraded = await PGlite.create()
  try {
    await frozen.exec(fixture(35))
    expect(await databaseVersion(frozen)).toBe(35)
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    await readsWhole(frozen, 35, 35)
    expect(await readKeySpends(frozen)).toEqual([
      { sessionId: 'ses_0000000000000000000000001', account: 'opencode-example', usd: 0.185, shared: false, firstAt: '2026-11-08T10:00:00.000Z', lastAt: '2026-11-08T10:20:00.000Z' },
      { sessionId: 'ses_0000000000000000000000002', account: 'opencode-example', usd: 0, shared: true, firstAt: '2026-11-08T11:00:00.000Z', lastAt: '2026-11-08T11:00:00.000Z' },
    ])
    await upgraded.exec(fixture(34))
    await upgraded.exec(STEPS[32]!)
    expect(await readKeySpends(upgraded)).toEqual([])
  } finally {
    await Promise.all([frozen.close(), made.close(), upgraded.close()])
  }
})

it("adds each growth to the session's sum and keeps a shared mark", { timeout: 120_000 }, async () => {
  const db = await openDatabase(undefined)
  try {
    await saveKeySpend(db, { sessionId: 's1', account: 'a', usd: 0.1, shared: false, at: '2026-11-08T10:00:00.000Z' })
    await saveKeySpend(db, { sessionId: 's1', account: 'a', usd: 0.05, shared: false, at: '2026-11-08T10:05:00.000Z' })
    await saveKeySpend(db, { sessionId: 's2', account: 'a', usd: 0, shared: true, at: '2026-11-08T10:06:00.000Z' })
    await saveKeySpend(db, { sessionId: 's2', account: 'a', usd: 0.2, shared: false, at: '2026-11-08T10:07:00.000Z' })
    const rows = await readKeySpends(db)
    expect(rows.map(({ sessionId, usd, shared, firstAt, lastAt }) => ({ sessionId, usd: Math.round(usd * 1000) / 1000, shared, firstAt, lastAt }))).toEqual([
      { sessionId: 's1', usd: 0.15, shared: false, firstAt: '2026-11-08T10:00:00.000Z', lastAt: '2026-11-08T10:05:00.000Z' },
      { sessionId: 's2', usd: 0.2, shared: true, firstAt: '2026-11-08T10:06:00.000Z', lastAt: '2026-11-08T10:07:00.000Z' },
    ])
  } finally {
    await db.close()
  }
})
