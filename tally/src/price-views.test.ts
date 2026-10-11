import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// The cost of a message (message_costs) on the whole schema.sql in an in-memory PGlite.
const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')

type Message = [id: string, model: string, input: number, cacheWrite5m: number, cacheWrite1h: number, cacheRead: number, output: number]

describe('cost of a message', () => {
  let db: PGlite

  beforeAll(async () => {
    db = await PGlite.create()
    await db.exec(SCHEMA)
    await db.exec(`insert into model_prices (model, input, output, cache_read, cache_write_5m, cache_write_1h,
        long_over, long_input, long_output, long_cache_read, long_cache_write_5m, long_cache_write_1h) values
      ('claude-haiku-5-5', 1, 10, 0.1, 2, 3, 100000, 5, 50, 0.5, 10, 15),
      ('claude-haiku-5', 100, 100, 100, 100, 100, null, null, null, null, null, null),
      ('claude-opus-5-5', 4, 20, 0.2, 5, 8, null, null, null, null, null, null)`)
    const messages: Message[] = [
      ['short', 'claude-haiku-5-5-20261001', 1000, 0, 0, 99000, 1000000],
      ['edge', 'claude-haiku-5-5', 25000, 25000, 25000, 25000, 0],
      ['long', 'claude-haiku-5-5', 1000, 0, 0, 99001, 1000000],
      ['flat', 'claude-opus-5-5', 1000000, 0, 0, 1000000, 0],
      ['none', 'claude-sonnet-9', 1000, 0, 0, 0, 0],
    ]
    for (const [id, model, input, cacheWrite5m, cacheWrite1h, cacheRead, output] of messages) {
      await db.query(
        `insert into messages (message_id, session_id, account, model, at, input, cache_write_5m, cache_write_1h, cache_read, output)
         values ($1, 's', 'a', $2, '2026-10-01T10:00:00Z', $3, $4, $5, $6, $7)`,
        [id, model, input, cacheWrite5m, cacheWrite1h, cacheRead, output],
      )
    }
  }, 30_000)

  afterAll(async () => {
    await db?.close()
  })

  async function costs(): Promise<Record<string, number | null>> {
    const { rows } = await db.query<{ message_id: string; cost: string | null }>('select message_id, cost from message_costs')
    return Object.fromEntries(rows.map((row) => [row.message_id, row.cost === null ? null : Number(row.cost)]))
  }

  it('prices a prompt up to the threshold at the base price of the longest prefix', async () => {
    const found = await costs()
    expect(found.short).toBeCloseTo(0.001 + 0.0099 + 10)
    expect(found.edge).toBeCloseTo(0.025 + 0.05 + 0.075 + 0.0025)
  })

  it('prices every token of a prompt over the threshold at the long prompt price', async () => {
    expect((await costs()).long).toBeCloseTo(0.005 + 0.0495005 + 50)
  })

  it('keeps the base price for a model without a long prompt price and none for an unpriced model', async () => {
    const found = await costs()
    expect(found.flat).toBeCloseTo(4 + 0.2)
    expect(found.none).toBeNull()
  })
})
