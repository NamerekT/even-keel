import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate, pgliteDb } from './migrations.js'

// limit_shares in one pass (BTN-1351) against its first body in schema.sql, the join of every response with every
// interval of its account: both over the same messages and snapshots of the whole migrated schema on in-memory PGlite.

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')
const OLD = SCHEMA.match(/create or replace view limit_shares as([\s\S]*?);/)![1]!

type Snapshot = [account: string, span: '5h' | '7d', observedAt: string, used: number, resetsAt: string]
type Message = [id: string, account: string, model: string, input: number, at: string]

const day = '2026-10-10T'
const snapshots: Snapshot[] = [
  // a, 5h: (10:30, 11:00] +10, (11:00, 11:30] +2, no growth by 12:00, (12:00, 12:30] +3; a new window from 15:00: (15:00, 16:00] +4.
  ['a', '5h', `${day}10:30:00Z`, 10, `${day}15:00:00Z`],
  ['a', '5h', `${day}11:00:00Z`, 20, `${day}15:00:00Z`],
  ['a', '5h', `${day}11:30:00Z`, 22, `${day}15:00:00Z`],
  ['a', '5h', `${day}12:00:00Z`, 22, `${day}15:00:00Z`],
  ['a', '5h', `${day}12:30:00Z`, 25, `${day}15:00:00Z`],
  ['a', '5h', `${day}16:00:00Z`, 4, `${day}20:00:00Z`],
  // a, 7d: (10:00, 13:00] +2.
  ['a', '7d', `${day}10:00:00Z`, 1, '2026-10-15T10:00:00Z'],
  ['a', '7d', `${day}13:00:00Z`, 3, '2026-10-15T10:00:00Z'],
  // b, 5h: (10:00, 11:00] +1 with only free and unpriced responses; 7d: (10:00, 10:20] +1 with none.
  ['b', '5h', `${day}10:00:00Z`, 1, `${day}14:00:00Z`],
  ['b', '5h', `${day}11:00:00Z`, 2, `${day}14:00:00Z`],
  ['b', '7d', `${day}10:00:00Z`, 5, '2026-10-15T10:00:00Z'],
  ['b', '7d', `${day}10:20:00Z`, 6, '2026-10-15T10:00:00Z'],
]

const messages: Message[] = [
  ['a-since', 'a', 'priced', 1, `${day}10:30:00Z`],
  ['a-inside', 'a', 'priced', 2, `${day}10:45:00Z`],
  ['a-till', 'a', 'priced', 3, `${day}11:00:00Z`],
  ['a-next', 'a', 'priced', 4, `${day}11:10:00Z`],
  ['a-flat', 'a', 'priced', 5, `${day}11:45:00Z`],
  ['a-later', 'a', 'priced', 6, `${day}12:15:00Z`],
  ['a-gap', 'a', 'priced', 7, `${day}14:00:00Z`],
  ['a-window', 'a', 'priced', 8, `${day}15:30:00Z`],
  ['a-unpriced', 'a', 'unknown', 9, `${day}15:45:00Z`],
  ['a-after', 'a', 'priced', 10, `${day}17:00:00Z`],
  ['b-free', 'b', 'priced', 0, `${day}10:30:00Z`],
  ['b-unpriced', 'b', 'unknown', 1, `${day}10:40:00Z`],
]

interface Share {
  key: string
  share: string | null
}

describe('limit_shares in one pass', () => {
  let db: PGlite

  beforeAll(async () => {
    db = await PGlite.create()
    await db.exec(`set timezone = 'UTC'`)
    await migrate(pgliteDb(db))
    await db.exec(`insert into model_prices (model, input, output, cache_read, cache_write_5m, cache_write_1h) values ('priced', 1, 1, 1, 1, 1)`)
    for (const [account, span, observedAt, used, resetsAt] of snapshots) {
      await db.query('insert into limit_snapshots (account, span, observed_at, used_percentage, resets_at, source) values ($1, $2, $3, $4, $5, $6)', [
        account,
        span,
        observedAt,
        used,
        resetsAt,
        'statusline',
      ])
    }
    for (const [id, account, model, input, at] of messages) {
      await db.query(
        `insert into messages (message_id, session_id, account, task, model, at, input, cache_write_5m, cache_write_1h, cache_read, output)
         values ($1, $1, $2, 'ABC-1', $3, $4, $5, 0, 0, 0, 0)`,
        [id, account, model, at, input * 1_000_000],
      )
    }
  }, 30_000)

  afterAll(async () => {
    await db?.close()
  })

  async function shares(from: string): Promise<Share[]> {
    const { rows } = await db.query<{ message_id: string; account: string; span: string; since: Date; till: Date; share: number | string | null }>(
      `select message_id, account, span, since, till, share from ${from} order by message_id, span, till`,
    )
    return rows.map((row) => ({
      key: `${row.message_id} ${row.account} ${row.span} ${row.since.toISOString()}–${row.till.toISOString()}`,
      share: row.share === null ? null : Number(row.share).toFixed(9),
    }))
  }

  it('gives every response the same shares as the join of every response with every interval', async () => {
    const { rows } = await db.query<{ body: string }>(`select pg_get_viewdef('limit_shares') as body`)
    expect(rows[0]!.body).toContain('next_till')
    const found = await shares('limit_shares')
    expect(found).toEqual(await shares(`(${OLD}) old`))
    expect(found.length).toBeGreaterThan(0)
  })

  it('takes a response at the end of an interval into it, at its start not, and none outside the intervals', async () => {
    const inFiveHours = (await shares('limit_shares')).filter((row) => row.key.includes(' 5h ')).map((row) => row.key.split(' ')[0])
    expect(inFiveHours).toEqual(['a-inside', 'a-later', 'a-next', 'a-till', 'a-unpriced', 'a-window', 'b-free', 'b-unpriced'])
  })

  it('splits the growth by cost and leaves an unknown or zero sum without a share', async () => {
    const found = Object.fromEntries((await shares('limit_shares')).filter((row) => row.key.includes(' 5h ')).map((row) => [row.key.split(' ')[0], row.share]))
    expect(found['a-inside']).toBe((10 * 2 / 5).toFixed(9))
    expect(found['a-till']).toBe((10 * 3 / 5).toFixed(9))
    expect(found['a-window']).toBe((4).toFixed(9))
    expect([found['a-unpriced'], found['b-free'], found['b-unpriced']]).toEqual([null, null, null])
  })

  it('keeps the columns of the view task_costs reads', async () => {
    const { rows } = await db.query<{ column_name: string; data_type: string }>(
      `select column_name, data_type from information_schema.columns where table_name = 'limit_shares' order by ordinal_position`,
    )
    expect(rows.map((row) => `${row.column_name} ${row.data_type}`)).toEqual([
      'account text',
      'span text',
      'since timestamp with time zone',
      'till timestamp with time zone',
      'message_id text',
      'session_id text',
      'task text',
      'share double precision',
    ])
  })
})
