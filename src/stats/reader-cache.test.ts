import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { parseConfig } from '../config.js'
import { StatsReader } from './reader.js'

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
