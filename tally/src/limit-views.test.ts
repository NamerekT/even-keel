import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Runs the limit views of schema.sql as CTEs over test snapshots that shadow limit_snapshots, so the read-only
// role is enough: in the live database with TALLY_DB_HOST and TALLY_READER_PASSWORD, otherwise in an in-memory PGlite.
const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')
const VIEWS = ['limit_steps', 'limit_intervals', 'limit_windows']

function viewBody(name: string): string {
  const found = SCHEMA.match(new RegExp(`create or replace view ${name} as([\\s\\S]*?);`))
  if (found === null) throw new Error(`view ${name} not found in schema.sql`)
  return found[1]!
}

const CTES = VIEWS.map((name) => `${name} as (${viewBody(name)})`).join(',\n')

const env = process.env
const live = Boolean(env.TALLY_DB_HOST && env.TALLY_READER_PASSWORD)

type Snapshot = [account: string, span: '5h' | '7d', observedAt: string, used: number, resetsAt: string, source: string]
type Client = { query(sql: string, params: unknown[]): Promise<{ rows: pg.QueryResultRow[] }>; end(): Promise<void> }

describe(`limit views (${live ? 'server' : 'PGlite'})`, () => {
  let client: Client

  beforeAll(async () => {
    if (!live) {
      const db = await PGlite.create()
      await db.exec(`set timezone = 'UTC'`)
      client = { query: (sql, params) => db.query(sql, params), end: () => db.close() }
      return
    }
    const server = new pg.Client({
      host: env.TALLY_DB_HOST,
      port: Number(env.TALLY_DB_PORT || 5432),
      database: env.TALLY_DB_NAME,
      user: env.TALLY_READER_USER || 'tally_reader',
      password: env.TALLY_READER_PASSWORD,
    })
    await server.connect()
    client = server
  }, 30_000)

  afterAll(async () => {
    await client?.end()
  })

  async function query(snapshots: Snapshot[], select: string): Promise<pg.QueryResultRow[]> {
    const values = snapshots.map((_, index) => `($${index * 6 + 1}::text, $${index * 6 + 2}::text, $${index * 6 + 3}::timestamptz,
      $${index * 6 + 4}::real, $${index * 6 + 5}::timestamptz, $${index * 6 + 6}::text)`)
    const sql = `with limit_snapshots (account, span, observed_at, used_percentage, resets_at, source) as (values ${values.join(', ')}),
      ${CTES}
      ${select}`
    return (await client.query(sql, snapshots.flat())).rows
  }

  async function intervals(snapshots: Snapshot[]): Promise<{ since: string; till: string; delta: number }[]> {
    const rows = await query(snapshots, 'select since, till, delta from limit_intervals order by till')
    return rows.map((row) => ({ since: row.since.toISOString(), till: row.till.toISOString(), delta: Number(row.delta) }))
  }

  const reset = '2026-10-10T13:00:00.000Z'
  const nearReset = '2026-10-10T12:59:00.000Z'

  it('gives no growth for two sources rounding differently in turn', async () => {
    const found = await intervals([
      ['global', '7d', '2026-10-04T10:00:00Z', 21, reset, 'statusline'],
      ['global', '7d', '2026-10-04T10:05:00Z', 22, nearReset, 'usage'],
      ['global', '7d', '2026-10-04T10:10:00Z', 21, reset, 'statusline'],
      ['global', '7d', '2026-10-04T10:15:00Z', 22, nearReset, 'usage'],
      ['global', '7d', '2026-10-04T10:20:00Z', 21, reset, 'statusline'],
      ['global', '7d', '2026-10-04T10:25:00Z', 23, nearReset, 'usage'],
    ])
    expect(found).toEqual([
      { since: '2026-10-04T10:00:00.000Z', till: '2026-10-04T10:05:00.000Z', delta: 1 },
      { since: '2026-10-04T10:20:00.000Z', till: '2026-10-04T10:25:00.000Z', delta: 1 },
    ])
  })

  it('counts a new window from its start with its whole percentage', async () => {
    const found = await intervals([
      ['global', '7d', '2026-10-10T12:00:00Z', 97, reset, 'usage'],
      ['global', '7d', '2026-10-10T14:00:00Z', 4, '2026-10-17T13:00:00Z', 'usage'],
      ['global', '7d', '2026-10-10T15:00:00Z', 6, '2026-10-17T13:00:00Z', 'usage'],
    ])
    expect(found).toEqual([
      { since: '2026-10-10T13:00:00.000Z', till: '2026-10-10T14:00:00.000Z', delta: 4 },
      { since: '2026-10-10T14:00:00.000Z', till: '2026-10-10T15:00:00.000Z', delta: 2 },
    ])
  })

  it('keeps accounts and spans apart', async () => {
    const found = await intervals([
      ['global', '7d', '2026-10-04T10:00:00Z', 10, reset, 'usage'],
      ['john.doe', '7d', '2026-10-04T10:05:00Z', 50, reset, 'usage'],
      ['global', '5h', '2026-10-04T10:06:00Z', 70, '2026-10-04T12:00:00Z', 'usage'],
      ['global', '7d', '2026-10-04T10:10:00Z', 12, reset, 'usage'],
    ])
    expect(found).toEqual([{ since: '2026-10-04T10:00:00.000Z', till: '2026-10-04T10:10:00.000Z', delta: 2 }])
  })

  it('gives the peak of every window', async () => {
    const rows = await query([
      ['global', '7d', '2026-10-09T10:00:00Z', 90, nearReset, 'usage'],
      ['global', '7d', '2026-10-10T12:00:00Z', 100, reset, 'statusline'],
      ['global', '7d', '2026-10-10T12:30:00Z', 99, nearReset, 'usage'],
      ['global', '7d', '2026-10-10T14:00:00Z', 4, '2026-10-17T13:00:00Z', 'usage'],
    ], 'select resets_at, starts_at, peak from limit_windows order by resets_at')
    expect(rows.map((row) => [row.resets_at.toISOString(), row.starts_at.toISOString(), Number(row.peak)])).toEqual([
      [reset, '2026-10-03T13:00:00.000Z', 100],
      ['2026-10-17T13:00:00.000Z', '2026-10-10T13:00:00.000Z', 4],
    ])
  })
})
