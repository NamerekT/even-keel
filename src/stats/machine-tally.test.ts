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
