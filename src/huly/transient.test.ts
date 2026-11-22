import { describe, expect, it } from 'vitest'
import { hulyTransient } from './transient.js'

const platform = (code: string, params: Record<string, unknown> = {}) =>
  Object.assign(new Error(`ERROR: ${code} ${JSON.stringify(params)}`), { name: 'PlatformError', status: { code, params } })
const named = (name: string, message: string) => Object.assign(new Error(message), { name })

describe('hulyTransient', () => {
  it("passes the SQL pool's memory budget, a closed connection and the network", () => {
    expect(hulyTransient(platform('platform:status:UnknownError', { message: 'sql: memory budget exceeded: 1044480 bytes requested' }))).toBe(true)
    expect(hulyTransient(platform('platform:status:ConnectionClosed'))).toBe(true)
    expect(hulyTransient(named('NetworkError', 'Network error TypeError: fetch failed'))).toBe(true)
    expect(hulyTransient(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }))).toBe(true)
    expect(hulyTransient(new Error('socket hang up'))).toBe(true)
  })

  it("passes the storage's 429 and 5xx", () => {
    expect(hulyTransient(named('StorageError', '<html><title>502 Bad Gateway</title></html>'))).toBe(true)
    expect(hulyTransient(named('StorageError', 'Too Many Requests'))).toBe(true)
    expect(hulyTransient(named('StorageError', 'Service Unavailable'))).toBe(true)
    expect(hulyTransient(Object.assign(new Error(''), { status: 503 }))).toBe(true)
    expect(hulyTransient(Object.assign(new Error(''), { status: 429 }))).toBe(true)
  })

  it('looks under the causes', () => {
    expect(hulyTransient(new Error('huly: findAll', { cause: platform('platform:status:ConnectionClosed') }))).toBe(true)
  })

  it('stops at once on what a repeat does not fix', () => {
    expect(hulyTransient(platform('platform:status:Unauthorized'))).toBe(false)
    expect(hulyTransient(platform('platform:status:Forbidden'))).toBe(false)
    expect(hulyTransient(platform('platform:status:UnknownError', { message: 'syntax error at or near "select"' }))).toBe(false)
    expect(hulyTransient(named('NotFoundError', ''))).toBe(false)
    expect(hulyTransient(named('StorageError', 'Forbidden'))).toBe(false)
    expect(hulyTransient(Object.assign(new Error(''), { status: 404 }))).toBe(false)
    expect(hulyTransient(new Error('huly: BTN-500 has unknown status 5f00'))).toBe(false)
    expect(hulyTransient('memory budget exceeded')).toBe(false)
  })
})
