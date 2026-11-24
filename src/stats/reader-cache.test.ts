import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseConfig } from '../config.js'
import { CHECKPOINT_WAIT_MS, StatsReader } from './reader.js'

const proxy = vi.hoisted(() => ({ query: null as null | ((sql: string, params?: unknown[]) => Promise<unknown>) }))
vi.mock('pg', () => ({ default: { Client: class {}, Pool: class {
  on() {}
  end() { return Promise.resolve() }
  query(sql: string, params?: unknown[]) { return proxy.query!(sql, params) }
} } }))

const settings = { host: 'localhost', port: 1, database: 'tally', user: 'reader', password: 'fake' }
const config = parseConfig({ projects: [] }).stats
const reader = () => new StatsReader(settings, () => ({ ABC: 'C:/example' }), () => config)

let spends: number
let fail: boolean

beforeEach(() => {
  spends = 0
  fail = false
  proxy.query = async (sql) => {
    if (sql.includes('to_regclass')) return { rows: [{ present: false }] }
    spends++
    if (fail) throw new Error('timeout exceeded when trying to connect')
    return { rows: [{ account: 'fake', day: 1, month: 2 }] }
  }
})

afterEach(() => { vi.useRealTimers() })

it('reads the database once for two calls in flight with the same key', async () => {
  const stats = reader()
  const [first, second] = await Promise.all([stats.spend('UTC'), stats.spend('UTC')])
  expect(first).toEqual({ state: 'ok', data: { fake: { day: 1, month: 2 } } })
  expect(second).toEqual(first)
  expect(spends).toBe(1)
})

it('does not keep an error for the minute a good answer stays', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  const stats = reader()
  fail = true
  expect(await stats.spend('UTC')).toEqual({ state: 'error', error: 'timeout exceeded when trying to connect' })
  fail = false
  vi.setSystemTime(Date.now() + 10_000)
  expect(await stats.spend('UTC')).toMatchObject({ state: 'ok' })
  vi.setSystemTime(Date.now() + 30_000)
  expect(await stats.spend('UTC')).toMatchObject({ state: 'ok' })
  expect(spends).toBe(2)
})

describe("the hook's checkpoint over a slow Tally (BTN-1634)", () => {
  const MEASURE = { key: 'ABC', handoffs: 3, sessions: 10, base: 1, note: 2, recovery: 3, cache_read: 0.5 }
  let held: (() => void)[]
  let reads: number

  beforeEach(() => {
    held = []
    reads = 0
    MEASURE.handoffs = 3
    proxy.query = async (sql) => {
      if (sql.includes('to_regclass')) return { rows: [{ present: false }] }
      reads++
      await new Promise<void>((resolve) => held.push(resolve))
      return { rows: [MEASURE] }
    }
  })

  const release = async () => {
    await vi.advanceTimersByTimeAsync(0)
    for (const resolve of held.splice(0)) resolve()
    await vi.advanceTimersByTimeAsync(0)
  }

  it('answers in CHECKPOINT_WAIT_MS with no measure while the first read is slow, and with the measure once it came', async () => {
    vi.useFakeTimers()
    const stats = reader()
    const first = stats.checkpoint('ABC')
    await vi.advanceTimersByTimeAsync(CHECKPOINT_WAIT_MS)
    expect(await first).toMatchObject({ project: 'ABC', handoffs: 0, sessions: 0 })
    await release()
    expect(await stats.checkpoint('ABC')).toMatchObject({ handoffs: 3, sessions: 10 })
    expect(reads).toBe(1)
  })

  it('answers the last measure at once while the expired one is read again', async () => {
    vi.useFakeTimers()
    const stats = reader()
    const first = stats.checkpoint('ABC')
    await release()
    expect(await first).toMatchObject({ handoffs: 3 })
    MEASURE.handoffs = 4
    vi.setSystemTime(Date.now() + 61_000)
    const second = stats.checkpoint('ABC')
    await vi.advanceTimersByTimeAsync(CHECKPOINT_WAIT_MS)
    expect(await second).toMatchObject({ handoffs: 3 })
    await release()
    expect(await stats.checkpoint('ABC')).toMatchObject({ handoffs: 4 })
    expect(reads).toBe(2)
  })
})
