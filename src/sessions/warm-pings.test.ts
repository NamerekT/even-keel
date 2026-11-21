import { describe, expect, it } from 'vitest'
import { warmPingOf } from './warm-pings.js'

const spend = { model: null, tokens: { input: 3, output: 4, cacheRead: 90_000, cacheWrite: 120 }, cost: null, durationMs: 900 }
const of = { at: '2026-11-12T10:04:00.000Z', sessionId: 'session-1', task: 'ABC-2', project: null, account: 'global', model: 'claude-opus-5-5' }

describe('warmPingOf', () => {
  it("puts the write under the session's lifetime: the fork asks for the same cache", () => {
    expect(warmPingOf(spend, { ...of, ttl: '5m' })).toMatchObject({ cacheWrite5m: 120, cacheWrite1h: 0, cacheRead: 90_000, input: 3, output: 4 })
    expect(warmPingOf(spend, { ...of, ttl: '1h' })).toMatchObject({ cacheWrite5m: 0, cacheWrite1h: 120 })
  })

  it("takes the model the answer names over the session's, and keeps no lifetime in the record", () => {
    const ping = warmPingOf({ ...spend, model: 'claude-opus-5-5-20261101' }, { ...of, ttl: '1h' })
    expect(ping.model).toBe('claude-opus-5-5-20261101')
    expect(ping).not.toHaveProperty('ttl')
    expect(warmPingOf(spend, { ...of, ttl: '5m' }).model).toBe('claude-opus-5-5')
  })
})
