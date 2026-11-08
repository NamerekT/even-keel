import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate, pgliteDb } from './migrations.js'

// The real spend of a session on its key laid over its responses (message_paid, step 12, BTN-860).

describe('paid cost of a message', () => {
  let db: PGlite

  beforeAll(async () => {
    db = await PGlite.create()
    await migrate(pgliteDb(db))
    await db.exec(`insert into model_prices (model, input, output, cache_read, cache_write_5m, cache_write_1h) values ('qwen-9', 1, 1, 0, 0, 0)`)
    const messages: [id: string, session: string, model: string, input: number][] = [
      ['a1', 'metered', 'qwen-9', 1_000_000],
      ['a2', 'metered', 'qwen-9', 3_000_000],
      ['b1', 'unpriced', 'free-9', 10],
      ['b2', 'unpriced', 'free-9', 10],
      ['c1', 'shared', 'qwen-9', 1_000_000],
      ['d1', 'plain', 'qwen-9', 2_000_000],
    ]
    for (const [id, session, model, input] of messages) {
      await db.query(
        `insert into messages (message_id, session_id, account, model, at, input, cache_write_5m, cache_write_1h, cache_read, output)
         values ($1, $2, 'a', $3, '2026-11-08T10:00:00Z', $4, 0, 0, 0, 0)`,
        [id, session, model, input],
      )
    }
    await db.exec(`insert into key_spends (session_id, account, usd, shared, first_at, last_at) values
      ('metered', 'a', 2, false, '2026-11-08T10:00:00Z', '2026-11-08T10:05:00Z'),
      ('unpriced', 'a', 0.5, false, '2026-11-08T10:00:00Z', '2026-11-08T10:05:00Z'),
      ('shared', 'a', 0, true, '2026-11-08T10:00:00Z', '2026-11-08T10:05:00Z')`)
  }, 30_000)

  afterAll(async () => {
    await db?.close()
  })

  async function paid(): Promise<Record<string, { cost: number | null; paid: number | null }>> {
    const { rows } = await db.query<{ message_id: string; cost: number | null; paid: number | null }>('select message_id, cost, paid from message_paid')
    const num = (value: number | null) => (value === null ? null : Number(value))
    return Object.fromEntries(rows.map((row) => [row.message_id, { cost: num(row.cost), paid: num(row.paid) }]))
  }

  it("lays a session's real spend over its responses in proportion to their estimate", async () => {
    const found = await paid()
    expect(found.a1!.cost).toBeCloseTo(1)
    expect(found.a1!.paid).toBeCloseTo(0.5)
    expect(found.a2!.paid).toBeCloseTo(1.5)
  })

  it('splits it evenly when the session has no estimate', async () => {
    const found = await paid()
    expect(found.b1).toEqual({ cost: null, paid: 0.25 })
    expect(found.b2!.paid).toBeCloseTo(0.25)
  })

  it('keeps the estimate for a shared session and one without a real spend', async () => {
    const found = await paid()
    expect(found.c1!.paid).toBeCloseTo(1)
    expect(found.d1!.paid).toBeCloseTo(2)
  })
})
