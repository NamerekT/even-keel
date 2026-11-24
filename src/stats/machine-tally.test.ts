import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { expect, it } from 'vitest'
import { TallyDb } from '../../tally/src/db.js'
import { openLocalTally } from '../../tally/src/local.js'
import { MachineTally } from './machine-tally.js'
import { TALLY_SCHEMA_VERSION } from './tally-schema.js'

const rows = {
  lines: [],
  messages: [],
  calls: [],
  results: [],
  sessions: [{ sessionId: 's1', account: 'global', project: 'example', customTitle: null, aiTitle: null, launchTask: null, launchReason: null, firstAt: '2026-11-17T10:00:00.000Z', lastAt: '2026-11-17T10:00:00.000Z' }],
}

it('takes no rows while the hub collects nothing, nor rows of another shape', async () => {
  const lines: string[] = []
  const tally = new MachineTally({ writer: async () => null, log: (line) => lines.push(line) })
  expect(await tally.take('machine-1', rows)).toEqual({ taken: false })
  expect(await tally.take('machine-1', { lines: 'nope' })).toEqual({ taken: false })
  expect(lines).toEqual(['tally: machine machine-1 sent rows of another shape; not written'])
})

it('writes the rows once the database is of this build’s schema, and not before', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tally-machine-'))
  const local = await openLocalTally(join(dir, 'db'), () => {})
  const tally = new MachineTally({ writer: async () => local.settings, log: () => {} })
  const client = new pg.Client(local.settings)
  try {
    const db = await TallyDb.connect(local.settings)
    await db.migrate()
    await db.close()
    await client.connect()
    // A database the hub's own run has not migrated to this build yet.
    await client.query('update schema_version set version = $1', [TALLY_SCHEMA_VERSION - 1])
    expect(await tally.take('machine-1', rows)).toEqual({ taken: false })
    await client.query('update schema_version set version = $1', [TALLY_SCHEMA_VERSION])
    expect(await tally.take('machine-1', rows)).toEqual({ taken: true })
    const { rows: sessions } = await client.query('select session_id, account, machine from sessions')
    expect(sessions).toEqual([{ session_id: 's1', account: 'global@machine-1', machine: 'machine-1' }])
  } finally {
    await client.end().catch(() => {})
    await local.close()
    rmSync(dir, { recursive: true, force: true })
  }
}, 60_000)

it("refreshes the stored limit shares after a post with responses, once the posts so far are written", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tally-machine-'))
  const local = await openLocalTally(join(dir, 'db'), () => {})
  const tally = new MachineTally({ writer: async () => local.settings, log: () => {} })
  const client = new pg.Client(local.settings)
  const response = {
    messageId: 'm1', sessionId: 's1', agentId: null, account: 'global', project: 'example', projectDir: null, task: 'ABC-1', branch: null,
    entrypoint: null, model: 'priced', speed: null, effort: null, at: '2026-11-17T10:30:00.000Z', input: 1_000_000, cacheWrite5m: 0, cacheWrite1h: 0,
    cacheRead: 0, output: 0, provider: null,
  }
  const stored = async () => (await client.query<{ message_id: string; share: number }>('select message_id, share from limit_shares_stored')).rows
  try {
    const db = await TallyDb.connect(local.settings)
    await db.migrate()
    await db.close()
    await client.connect()
    await client.query(`insert into model_prices (model, input, output, cache_read, cache_write_5m, cache_write_1h) values ('priced', 1, 1, 1, 1, 1)`)
    // The machine's account, 7d: (10:00, 11:00] +2.
    await client.query(
      `insert into limit_snapshots (account, span, observed_at, used_percentage, resets_at, source) values
        ('global@machine-1', '7d', '2026-11-17T10:00:00Z', 1, '2026-11-20T10:00:00Z', 'statusline'),
        ('global@machine-1', '7d', '2026-11-17T11:00:00Z', 3, '2026-11-20T10:00:00Z', 'statusline')`,
    )
    expect(await tally.take('machine-1', rows)).toEqual({ taken: true })
    await tally.settled()
    expect(await stored()).toEqual([])
    expect(await tally.take('machine-1', { ...rows, messages: [response] })).toEqual({ taken: true })
    await tally.settled()
    expect(await stored()).toEqual([{ message_id: 'm1', share: 2 }])
  } finally {
    await client.end().catch(() => {})
    await local.close()
    rmSync(dir, { recursive: true, force: true })
  }
}, 60_000)
