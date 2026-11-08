import { describe, expect, it } from 'vitest'
import { KeySpend, openRouterUsage, type KeySpendGrowth } from './spend.js'

const KEY = 'sk-or-v1-fake-0000'
const A = 'opencode-a'

/** A key whose `usage` the test sets; `null` — the read fails. */
function bench(options: { tailMs?: number; pollMs?: number } = {}) {
  let usage: number | null = 0
  let now = 0
  const spent: KeySpendGrowth[] = []
  const meter = new KeySpend({
    metered: (account) => account === A,
    read: async () => usage,
    onSpend: (growth) => spent.push(growth),
    now: () => now,
    tailMs: options.tailMs ?? 600_000,
    pollMs: options.pollMs ?? 60_000,
  })
  return {
    meter,
    spent,
    set: (value: number | null) => {
      usage = value
    },
    at: (ms: number) => {
      now = ms
    },
    /** One monitor tick: the busy sessions of the account `A`, and the idle ones. */
    tick: async (busy: string[], idle: string[] = []) => {
      meter.observe([...busy.map((sessionId) => ({ account: A, sessionId, busy: true })), ...idle.map((sessionId) => ({ account: A, sessionId, busy: false }))])
      await meter.settled()
    },
    total: (sessionId: string) => spent.filter((each) => each.sessionId === sessionId).reduce((sum, each) => sum + each.usd, 0),
    shared: (sessionId: string) => spent.some((each) => each.sessionId === sessionId && each.shared),
  }
}

describe('openRouterUsage (BTN-860)', () => {
  it("reads the key's usage in dollars with the key as a bearer token", async () => {
    let seen: { url: string; headers: Headers } | undefined
    const fetchImpl: typeof fetch = async (url, init) => {
      seen = { url: String(url), headers: new Headers(init?.headers) }
      return new Response(JSON.stringify({ data: { label: 'sk-or-v1-fak...000', usage: 1.2345, usage_daily: 0.2 } }), { status: 200 })
    }
    expect(await openRouterUsage(KEY, 1000, fetchImpl)).toBe(1.2345)
    expect(seen?.url).toBe('https://openrouter.ai/api/v1/key')
    expect(seen?.headers.get('authorization')).toBe(`Bearer ${KEY}`)
  })

  it('gives null for an error, a body without usage and a failed request', async () => {
    expect(await openRouterUsage(KEY, 1000, async () => new Response('{}', { status: 401 }))).toBeNull()
    expect(await openRouterUsage(KEY, 1000, async () => new Response(JSON.stringify({ data: { usage: 'x' } }), { status: 200 }))).toBeNull()
    expect(await openRouterUsage(KEY, 1000, async () => {
      throw new TypeError('fetch failed')
    })).toBeNull()
  })
})

describe('KeySpend (BTN-860)', () => {
  it("gives a session the growth of the key's usage from before its turn to the turn's end", async () => {
    const run = bench()
    run.set(10)
    await run.meter.beforeTurn(A)
    run.at(3_000)
    await run.tick(['s1'])
    run.set(10.25)
    run.at(6_000)
    await run.tick([], ['s1'])
    expect(run.total('s1')).toBeCloseTo(0.25)
    run.set(10.5)
    await run.meter.beforeTurn(A)
    run.at(9_000)
    await run.tick(['s1'])
    run.set(10.75)
    run.at(12_000)
    await run.tick([], ['s1'])
    expect(run.total('s1')).toBeCloseTo(0.75)
    expect(run.shared('s1')).toBe(false)
  })

  it('gives growth that arrives after the turn to that session at a tail poll', async () => {
    const run = bench({ pollMs: 60_000, tailMs: 600_000 })
    run.set(1)
    await run.meter.beforeTurn(A)
    await run.tick(['s1'])
    run.at(5_000)
    await run.tick([])
    expect(run.total('s1')).toBe(0)
    run.set(1.4)
    run.at(30_000)
    await run.tick([])
    expect(run.total('s1')).toBe(0)
    run.at(65_000)
    await run.tick([])
    expect(run.total('s1')).toBeCloseTo(0.4)
  })

  it("gives the late growth of the last session to it, not to the next session's turn", async () => {
    const run = bench()
    run.set(2)
    await run.meter.beforeTurn(A)
    await run.tick(['s1'])
    run.at(5_000)
    await run.tick([])
    run.set(2.3)
    run.at(10_000)
    await run.meter.beforeTurn(A)
    await run.tick(['s2'])
    run.set(2.5)
    run.at(15_000)
    await run.tick([])
    expect(run.total('s1')).toBeCloseTo(0.3)
    expect(run.total('s2')).toBeCloseTo(0.2)
  })

  it('gives nobody what the key spent after the tail ended', async () => {
    const run = bench({ tailMs: 120_000, pollMs: 60_000 })
    run.set(5)
    await run.meter.beforeTurn(A)
    await run.tick(['s1'])
    run.at(1_000)
    await run.tick([])
    for (const at of [70_000, 130_000, 200_000]) {
      run.at(at)
      await run.tick([])
    }
    run.set(7)
    run.at(300_000)
    await run.meter.beforeTurn(A)
    await run.tick(['s2'])
    run.at(303_000)
    await run.tick([])
    expect(run.total('s1')).toBe(0)
    expect(run.total('s2')).toBe(0)
  })

  it('marks two sessions busy at once on one key shared and gives neither a sum', async () => {
    const run = bench()
    run.set(0)
    await run.meter.beforeTurn(A)
    await run.tick(['s1'])
    await run.tick(['s1', 's2'])
    run.set(1)
    run.at(4_000)
    await run.tick([], ['s1', 's2'])
    expect(run.shared('s1')).toBe(true)
    expect(run.shared('s2')).toBe(true)
    expect(run.total('s1')).toBe(0)
    expect(run.total('s2')).toBe(0)
  })

  it('marks two sessions that ran between the same two reads shared', async () => {
    const run = bench()
    run.set(0)
    await run.meter.beforeTurn(A)
    await run.tick(['s1'])
    run.at(3_000)
    // s2's turn started without a read before it (a message into the session), while s1's turn ended in the same tick.
    run.meter.observe([{ account: A, sessionId: 's2', busy: true }])
    run.set(0.5)
    run.at(6_000)
    await run.tick([])
    expect(run.shared('s1')).toBe(true)
    expect(run.shared('s2')).toBe(true)
    expect(run.total('s1') + run.total('s2')).toBe(0)
  })

  it('keeps a failed read from losing the growth: the next read gives it to the session', async () => {
    const run = bench()
    run.set(3)
    await run.meter.beforeTurn(A)
    await run.tick(['s1'])
    run.set(null)
    run.at(3_000)
    await run.tick([])
    run.set(3.6)
    run.at(70_000)
    await run.tick([])
    expect(run.total('s1')).toBeCloseTo(0.6)
  })

  it('reads no account the meter does not cover, and no session before a first read', async () => {
    let reads = 0
    const meter = new KeySpend({ metered: () => false, read: async () => (reads++, 1), onSpend: () => {}, now: () => 0, tailMs: 1, pollMs: 1 })
    await meter.beforeTurn('codex')
    meter.observe([{ account: 'codex', sessionId: 's', busy: true }])
    await meter.settled()
    expect(reads).toBe(0)
  })

  it('gives a falling usage to nobody', async () => {
    const run = bench()
    run.set(9)
    await run.meter.beforeTurn(A)
    await run.tick(['s1'])
    run.set(1)
    run.at(3_000)
    await run.tick([])
    expect(run.total('s1')).toBe(0)
    expect(run.spent.filter((each) => each.usd < 0)).toEqual([])
  })
})
