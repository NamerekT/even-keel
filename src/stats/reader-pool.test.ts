import { EventEmitter } from 'node:events'
import pg from 'pg'
import { afterEach, expect, it, vi } from 'vitest'
import { CONNECT_MS, readerPool } from './reader.js'

const QUERY_MS = 6_000
const configs: Array<{ connectionTimeoutMillis?: number }> = []

// A client that connects at once and answers each query after QUERY_MS, as a busy Tally does.
class SlowClient extends EventEmitter {
  constructor(config: { connectionTimeoutMillis?: number }) {
    super()
    configs.push(config)
  }
  connect(callback: (error?: Error) => void): void { callback() }
  query(_sql: string, _values: unknown, callback: (error: Error | null, result?: unknown) => void): void {
    setTimeout(() => callback(null, { rows: [] }), QUERY_MS)
  }
  end(callback?: () => void): void {
    this.emit('end')
    callback?.()
  }
}

const settings = { host: 'localhost', port: 1, database: 'tally', user: 'reader', password: 'fake' }

afterEach(() => {
  vi.useRealTimers()
  configs.length = 0
})

it('keeps a queue longer than the pool waiting instead of failing on the connect timeout', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const pool = readerPool(settings, SlowClient as unknown as typeof pg.Client)
  const queries = Array.from({ length: 16 }, () => pool.query('select 1').then(() => 'ok', (error: Error) => error.message))
  await vi.advanceTimersByTimeAsync(3 * QUERY_MS)
  expect(await Promise.all(queries)).toEqual(Array(16).fill('ok'))
  await pool.end()
})

it('gives each connection its own short connect timeout', async () => {
  const pool = readerPool(settings, SlowClient as unknown as typeof pg.Client)
  const client = await pool.connect()
  client.release()
  expect(configs[0]?.connectionTimeoutMillis).toBe(CONNECT_MS)
  await pool.end()
})
