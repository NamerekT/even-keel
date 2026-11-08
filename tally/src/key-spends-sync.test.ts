import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { expect, it } from 'vitest'
import type { SessionKeySpend } from '../../src/account/spend.js'
import { TallyDb } from './db.js'
import { openLocalTally } from './local.js'

const spend = (sessionId: string, usd: number, shared = false): SessionKeySpend => ({
  sessionId, account: 'opencode-a', usd, shared, firstAt: '2026-11-08T10:00:00.000Z', lastAt: '2026-11-08T10:05:00.000Z',
})

it("replaces Tally's copy of the key spends whole", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tally-key-spends-'))
  const local = await openLocalTally(join(dir, 'db'), () => {})
  const db = await TallyDb.connect(local.settings)
  try {
    await db.migrate()
    await db.syncKeySpends([spend('s1', 1.5), spend('s2', 0, true)])
    await db.syncKeySpends([spend('s2', 0, true), spend('s3', 0.25)])
    const client = new pg.Client(local.settings)
    await client.connect()
    const { rows } = await client.query<{ session_id: string; usd: number; shared: boolean; last_at: Date }>(
      'select session_id, usd, shared, last_at from key_spends order by session_id',
    )
    await client.end()
    expect(rows.map((row) => [row.session_id, Number(row.usd), row.shared])).toEqual([['s2', 0, true], ['s3', 0.25, false]])
    expect(new Date(rows[0]!.last_at).toISOString()).toBe('2026-11-08T10:05:00.000Z')
  } finally {
    await db.close()
    await local.close()
    rmSync(dir, { recursive: true, force: true })
  }
}, 60_000)
