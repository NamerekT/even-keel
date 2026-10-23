import { describe, expect, it } from 'vitest'
import { LimitRetries, noKnownLimit } from './retry.js'

const MIN = 60_000
const T0 = Date.parse('2026-10-24T10:00:00.000Z')
const at = (ms: number) => new Date(T0 + ms).toISOString()

describe('LimitRetries', () => {
  it('tries again a quarter of an hour after the first limit, the same time for the same hit', () => {
    const retries = new LimitRetries()
    expect(retries.retryAfter('zen', at(0))).toBe(at(15 * MIN))
    expect(retries.retryAfter('zen', at(0))).toBe(at(15 * MIN))
    expect(retries.lastAt('zen')).toBe(at(0))
    expect(retries.lastAt('other')).toBeNull()
  })

  it('doubles the wait while each retry hits the limit again, up to four hours', () => {
    const retries = new LimitRetries()
    let hit = 0
    const waits: number[] = []
    for (let step = 0; step < 7; step++) {
      const retry = Date.parse(retries.retryAfter('zen', at(hit))) - T0
      waits.push((retry - hit) / MIN)
      hit = retry + 2 * MIN
    }
    expect(waits).toEqual([15, 30, 60, 120, 240, 240, 240])
  })

  it('starts over once the account worked longer than the last wait', () => {
    const retries = new LimitRetries()
    retries.retryAfter('zen', at(0))
    retries.retryAfter('zen', at(17 * MIN))
    expect(retries.retryAfter('zen', at(17 * MIN + 45 * MIN + 31 * MIN))).toBe(at(93 * MIN + 15 * MIN))
  })

  it('keeps accounts apart and answers an older hit without moving the step', () => {
    const retries = new LimitRetries()
    retries.retryAfter('zen', at(0))
    expect(retries.retryAfter('copilot', at(5 * MIN))).toBe(at(20 * MIN))
    retries.retryAfter('zen', at(16 * MIN))
    expect(retries.retryAfter('zen', at(0))).toBe(at(15 * MIN))
    expect(retries.retryAfter('zen', at(16 * MIN))).toBe(at(46 * MIN))
    expect(retries.lastAt('zen')).toBe(at(16 * MIN))
  })
})

describe('noKnownLimit', () => {
  const stale = { state: 'stale' as const, reason: null, since: at(0) }

  it('is a poll that found nothing to read and no window', () => {
    expect(noKnownLimit(null, stale)).toBe(true)
    expect(noKnownLimit({ fiveHour: null, sevenDay: null, updatedAt: at(0), source: 'usage' as const }, stale)).toBe(true)
  })

  it('is not a poll yet to answer, one that failed to read, or an account with a window', () => {
    expect(noKnownLimit(null, { state: 'waiting', reason: null, since: null })).toBe(false)
    expect(noKnownLimit(null, { ...stale, state: 'unread' })).toBe(false)
    const month = { fiveHour: null, sevenDay: null, month: { usedPercentage: 40, resetsAt: at(0) }, updatedAt: at(0), source: 'usage' as const }
    expect(noKnownLimit(month, stale)).toBe(false)
  })
})
