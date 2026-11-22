import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import pg from 'pg'
import { expect, it } from 'vitest'
import { TallyDb } from './db.js'
import { openLocalTally } from './local.js'
import { migrate, pgliteDb, STEPS } from './migrations.js'
import type { LineRow } from './parse.js'

// Schema step 22 (BTN-1471): the raw row leaves `lines` for `line_raws`, keyed by the row's uuid.

const at = '2026-10-01T10:00:00.000Z'
const boundary = { type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'auto', preTokens: 200000, postTokens: 30000, durationMs: 26 } }
const summary = (parentUuid: string) => ({ type: 'user', parentUuid, isCompactSummary: true, message: { role: 'user', content: 'x'.repeat(1200) } })
const COMPACTIONS = 'select uuid, trigger, pre_tokens, summary_chars, seq from compactions order by uuid'

const columns = async (db: PGlite, table: string) =>
  (await db.query<{ column_name: string }>(
    `select column_name from information_schema.columns where table_name = $1 order by ordinal_position`, [table],
  )).rows.map((row) => row.column_name)

it('moves the raw rows of a v21 database into line_raws and leaves lines narrow', async () => {
  const db = await PGlite.create()
  try {
    await db.exec(`set timezone = 'UTC'`)
    await migrate(pgliteDb(db), STEPS.slice(0, 21))
    const old: [uuid: string, agent: string | null, raw: Record<string, unknown>][] = [
      ['b1', null, { ...boundary, uuid: 'b1' }],
      ['s1', null, { ...summary('b1'), uuid: 's1' }],
      ['a1', 'agent', { type: 'assistant', uuid: 'a1', message: { id: 'm1' } }],
    ]
    for (const [uuid, agent, raw] of old) {
      await db.query('insert into lines (uuid, session_id, agent_id, type, at, raw) values ($1, $2, $3, $4, $5, $6)', [uuid, 's', agent, raw.type, at, raw])
    }
    const compactions = (await db.query(COMPACTIONS)).rows

    await migrate(pgliteDb(db))

    expect(await columns(db, 'lines')).toEqual(['uuid', 'session_id', 'agent_id', 'type', 'at'])
    expect(await columns(db, 'line_raws')).toEqual(['uuid', 'raw'])
    expect((await db.query('select uuid, session_id, agent_id, type, at::text from lines order by uuid')).rows).toEqual([
      { uuid: 'a1', session_id: 's', agent_id: 'agent', type: 'assistant', at: '2026-10-01 10:00:00+00' },
      { uuid: 'b1', session_id: 's', agent_id: null, type: 'system', at: '2026-10-01 10:00:00+00' },
      { uuid: 's1', session_id: 's', agent_id: null, type: 'user', at: '2026-10-01 10:00:00+00' },
    ])
    expect((await db.query('select uuid, raw from line_raws order by uuid')).rows).toEqual(
      old.map(([uuid, , raw]) => ({ uuid, raw })).sort((a, b) => a.uuid.localeCompare(b.uuid)),
    )
    expect((await db.query(COMPACTIONS)).rows).toEqual(compactions)
    const indexes = (await db.query<{ indexname: string }>(`select indexname from pg_indexes where tablename in ('lines', 'line_raws') order by indexname`)).rows
    expect(indexes.map((row) => row.indexname)).toEqual(['line_raws_pkey', 'lines_pkey', 'lines_session_at'])
  } finally {
    await db.close()
  }
}, 60_000)

it('writes the narrow row into lines and its raw into line_raws, once, and still records compactions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tally-line-raws-'))
  const local = await openLocalTally(join(dir, 'db'), () => {})
  const db = await TallyDb.connect(local.settings)
  const client = new pg.Client(local.settings)
  try {
    await db.migrate()
    const line = (uuid: string, raw: Record<string, unknown>): LineRow => ({ uuid, sessionId: 's', agentId: null, type: raw.type as string, at, raw: { ...raw, uuid } })
    const rows = { lines: [line('b1', boundary), line('s1', summary('b1'))], messages: [], calls: [], results: [], sessions: [] }
    await db.writeMachine('machine-1', rows)
    await db.writeMachine('machine-1', { ...rows, lines: [line('b1', { ...boundary, changed: true })] })

    await client.connect()
    expect((await client.query('select uuid, type from lines order by uuid')).rows).toEqual([{ uuid: 'b1', type: 'system' }, { uuid: 's1', type: 'user' }])
    expect((await client.query(`select raw from line_raws where uuid = 'b1'`)).rows).toEqual([{ raw: { ...boundary, uuid: 'b1' } }])
    expect((await client.query('select uuid, trigger, pre_tokens, summary_chars, seq from compactions')).rows).toEqual([
      { uuid: 'b1', trigger: 'auto', pre_tokens: 200000, summary_chars: 1200, seq: 1 },
    ])
  } finally {
    await client.end().catch(() => {})
    await db.close()
    await local.close()
    rmSync(dir, { recursive: true, force: true })
  }
}, 60_000)
