import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fixture } from '../../src/storage/database.fixture.js'
import { migrate, pgliteDb } from './migrations.js'
import { warmPings } from './warm-pings.js'

// The keep-warm pings in Tally (BTN-1413): what the collector takes from Even Keel's state database, and the views
// that price them, give them their part of a limit's growth and add them to their task.

it("takes the hub's own pings without a machine and a machine elsewhere's under its account", { timeout: 60_000 }, async () => {
  const state = await PGlite.create()
  try {
    expect(await warmPings(state)).toBeUndefined()
    await state.exec(fixture(70))
    await state.exec(`insert into service_state (name, value) values ('machines.own', '"machine-own-0001"')`)
    const pings = (await warmPings(state))!
    expect(pings.map((ping) => [ping.machine, ping.account, ping.task])).toEqual([
      ['', 'global', 'ABC-2'],
      ['machine-laptop-0001', 'codex-example@machine-laptop-0001', 'XYZ-7'],
    ])
  } finally {
    await state.close()
  }
})

describe('keep-warm pings in the views', () => {
  let db: PGlite

  beforeAll(async () => {
    db = await PGlite.create()
    await db.exec(`set timezone = 'UTC'`)
    await migrate(pgliteDb(db))
    // The shorter prefix is the wrong price: a ping takes the longest one, as a response does.
    await db.exec(`insert into model_prices (model, input, output, cache_read, cache_write_5m, cache_write_1h) values
      ('claude-opus-5', 100, 100, 100, 100, 100), ('claude-opus-5-5', 1, 1, 0.1, 1, 2)`)
    // a, 5h: (10:00, 11:00] +4.
    await db.exec(`insert into limit_snapshots (account, span, observed_at, used_percentage, resets_at, source) values
      ('a', '5h', '2026-11-12T10:00:00Z', 10, '2026-11-12T14:00:00Z', 'statusline'),
      ('a', '5h', '2026-11-12T11:00:00Z', 14, '2026-11-12T14:00:00Z', 'statusline')`)
    await db.exec(`insert into messages (message_id, session_id, account, task, model, at, input, cache_write_5m, cache_write_1h, cache_read, output)
      values ('m1', 's1', 'a', 'ABC-1', 'claude-opus-5-5', '2026-11-12T10:30:00Z', 2000000, 0, 0, 0, 0)`)
    // The ping's task was copied into another tracker: it counts for the new id.
    await db.exec(`insert into task_moves (old_task, task) values ('OLD-1', 'ABC-1')`)
    await db.exec(`insert into warm_pings (session_id, at, machine, account, task, project_id, model, input, cache_write_5m, cache_write_1h, cache_read, output) values
      ('s1', '2026-11-12T10:45:00Z', '', 'a', 'OLD-1', null, 'claude-opus-5-5', 0, 0, 500000, 10000000, 0),
      ('s1', '2026-11-12T12:00:00Z', '', 'a', 'ABC-1', null, 'unknown', 5, 0, 0, 0, 1)`)
  }, 30_000)

  afterAll(async () => {
    await db?.close()
  })

  it('prices a ping by the longest config prefix of its model and moves its task', async () => {
    const { rows } = await db.query<{ ping_id: string; task: string; price_model: string | null; cost: string | null }>(
      'select ping_id, task, price_model, cost from warm_ping_costs order by at',
    )
    expect(rows.map((row) => [row.ping_id, row.task, row.price_model, row.cost === null ? null : Number(row.cost)])).toEqual([
      [`warm:s1:${Date.parse('2026-11-12T10:45:00Z')}`, 'ABC-1', 'claude-opus-5-5', 2],
      [`warm:s1:${Date.parse('2026-11-12T12:00:00Z')}`, 'ABC-1', null, null],
    ])
  })

  it("shares a limit's growth between a response and a ping by their cost", async () => {
    const { rows } = await db.query<{ message_id: string; share: number }>(`select message_id, share from limit_shares where span = '5h' order by message_id`)
    expect(rows.map((row) => [row.message_id, Number(row.share)])).toEqual([
      ['m1', 2],
      [`warm:s1:${Date.parse('2026-11-12T10:45:00Z')}`, 2],
    ])
  })

  it("adds the task's pings apart from the cost of its responses and their share to its limit", async () => {
    const { rows } = await db.query<{ cost: string; five_hour_share: number; warm_pings: string; warm_cost: string }>(
      `select cost, five_hour_share, warm_pings, warm_cost from task_costs where task = 'ABC-1'`,
    )
    expect(rows.map((row) => [Number(row.cost), Number(row.five_hour_share), Number(row.warm_pings), Number(row.warm_cost)])).toEqual([[2, 4, 2, 2]])
  })
})
