import { describe, expect, it } from 'vitest'
import { currentLimits, exhaustedReset, limitResetAfter, limitsFileDir, newestLimits, parseLimitsFile } from './model.js'

const RECEIVED_AT = '2026-01-01T12:00:00.000Z'
const FIVE_HOUR_RESET = Date.UTC(2026, 0, 1, 15, 0, 0) / 1000
const SEVEN_DAY_RESET = Date.UTC(2026, 0, 5, 9, 30, 0) / 1000

function snapshot(rateLimits: unknown, receivedAt = RECEIVED_AT): unknown {
  return { receivedAt, rate_limits: rateLimits }
}

describe('limitsFileDir', () => {
  it('names the config folder of the session that wrote the snapshot', () => {
    expect(limitsFileDir({ ...(snapshot({}) as object), configDir: 'C:\\Users\\john\\.claude-accounts\\work' })).toBe(
      'C:\\Users\\john\\.claude-accounts\\work',
    )
  })

  it('takes a snapshot without a folder for the global one', () => {
    expect(limitsFileDir(snapshot({}))).toBeNull()
    expect(limitsFileDir({ ...(snapshot({}) as object), configDir: '' })).toBeNull()
    expect(limitsFileDir(null)).toBeNull()
  })
})

describe('parseLimitsFile', () => {
  it('reads both windows from the statusline rate_limits object', () => {
    const limits = parseLimitsFile(
      snapshot({
        five_hour: { used_percentage: 23.5, resets_at: FIVE_HOUR_RESET },
        seven_day: { used_percentage: 41.2, resets_at: SEVEN_DAY_RESET },
      }),
    )

    expect(limits).toEqual({
      fiveHour: { usedPercentage: 23.5, resetsAt: '2026-01-01T15:00:00.000Z' },
      sevenDay: { usedPercentage: 41.2, resetsAt: '2026-01-05T09:30:00.000Z' },
      updatedAt: RECEIVED_AT, source: 'statusline' as const,
    })
  })

  it('keeps a window that is present when the other one is missing', () => {
    const limits = parseLimitsFile(snapshot({ seven_day: { used_percentage: 7, resets_at: SEVEN_DAY_RESET } }))

    expect(limits?.fiveHour).toBeNull()
    expect(limits?.sevenDay).toEqual({ usedPercentage: 7, resetsAt: '2026-01-05T09:30:00.000Z' })
  })

  it('treats a window with malformed numbers as missing', () => {
    const limits = parseLimitsFile(
      snapshot({
        five_hour: { used_percentage: '23', resets_at: FIVE_HOUR_RESET },
        seven_day: { used_percentage: 41.2, resets_at: null },
      }),
    )

    expect(limits).toEqual({ fiveHour: null, sevenDay: null, updatedAt: RECEIVED_AT, source: 'statusline' as const })
  })

  it('ignores the spend_limit window', () => {
    const limits = parseLimitsFile(snapshot({ spend_limit: { used_percentage: 120, resets_at: SEVEN_DAY_RESET } }))

    expect(limits).toEqual({ fiveHour: null, sevenDay: null, updatedAt: RECEIVED_AT, source: 'statusline' as const })
  })

  it.each([
    ['not an object', 'garbage'],
    ['no rate_limits', { receivedAt: RECEIVED_AT }],
    ['rate_limits is not an object', snapshot(42)],
    ['no receivedAt', { rate_limits: {} }],
    ['receivedAt is not a date', snapshot({}, 'yesterday')],
  ])('rejects a file with %s', (_case, raw) => {
    expect(parseLimitsFile(raw)).toBeUndefined()
  })
})

describe('currentLimits', () => {
  const limits = {
    fiveHour: { usedPercentage: 90, resetsAt: '2026-01-01T15:00:00.000Z' },
    sevenDay: { usedPercentage: 41.2, resetsAt: '2026-01-05T09:30:00.000Z' },
    updatedAt: RECEIVED_AT, source: 'statusline' as const,
  }

  it('returns the windows unchanged before they reset', () => {
    expect(currentLimits(limits, new Date('2026-01-01T14:59:59.000Z'))).toEqual(limits)
  })

  it('drops a snapshot taken before the current account was signed in', () => {
    expect(currentLimits(limits, new Date('2026-01-01T14:00:00.000Z'), '2026-01-01T12:30:00.000Z')).toBeNull()
    expect(currentLimits(limits, new Date('2026-01-01T14:00:00.000Z'), '2026-01-01T11:30:00.000Z')).toEqual(limits)
  })

  it('drops a window once its reset time has passed', () => {
    expect(currentLimits(limits, new Date('2026-01-01T15:00:00.000Z'))).toEqual({ ...limits, fiveHour: null })
  })

  it('returns null when nothing has been received yet', () => {
    expect(currentLimits(undefined, new Date(RECEIVED_AT))).toBeNull()
  })
})

describe('newestLimits', () => {
  const at = (updatedAt: string) => ({ fiveHour: null, sevenDay: null, updatedAt, source: 'usage' as const })

  it('takes the snapshot received last', () => {
    expect(newestLimits(at('2026-01-01T12:00:00.000Z'), at('2026-01-01T12:00:30.000Z'))).toEqual(at('2026-01-01T12:00:30.000Z'))
    expect(newestLimits(at('2026-01-01T12:01:00.000Z'), at('2026-01-01T12:00:30.000Z'))).toEqual(at('2026-01-01T12:01:00.000Z'))
  })

  it('takes whichever snapshot exists', () => {
    expect(newestLimits(undefined, at(RECEIVED_AT))).toEqual(at(RECEIVED_AT))
    expect(newestLimits(at(RECEIVED_AT), undefined)).toEqual(at(RECEIVED_AT))
    expect(newestLimits(undefined, undefined)).toBeUndefined()
  })
})

describe('exhaustedReset', () => {
  const window = (usedPercentage: number, resetsAt: string) => ({ usedPercentage, resetsAt })

  it('takes the latest reset among the exhausted windows', () => {
    const limits = {
      fiveHour: window(100, '2026-09-27T17:00:00.000Z'),
      sevenDay: window(100, '2026-09-30T08:00:00.000Z'),
      updatedAt: RECEIVED_AT, source: 'statusline' as const,
    }
    expect(exhaustedReset(limits)).toBe('2026-09-30T08:00:00.000Z')
  })

  it('knows nothing when no window is exhausted', () => {
    expect(exhaustedReset({ fiveHour: window(71, '2026-09-27T17:00:00.000Z'), sevenDay: null, updatedAt: RECEIVED_AT, source: 'statusline' as const })).toBeNull()
    expect(exhaustedReset(null)).toBeNull()
  })
})

describe('limitResetAfter', () => {
  const HIT = '2026-10-15T23:21:26.679Z'
  const window = (usedPercentage: number, resetsAt: string) => ({ usedPercentage, resetsAt })
  const limits = (fiveHour: { usedPercentage: number; resetsAt: string } | null, updatedAt: string, source: 'usage' | 'statusline' = 'usage') => ({
    fiveHour,
    sevenDay: window(25, '2026-10-22T15:00:00.000Z'),
    updatedAt,
    source,
  })

  it('takes the reset of an exhausted window', () => {
    const spent = limits(window(100, '2026-10-16T01:00:00.000Z'), '2026-10-15T23:00:00.000Z')
    expect(limitResetAfter(spent, HIT)).toBe('2026-10-16T01:00:00.000Z')
  })

  it('takes the end of the five-hour window the limit fell into when the window is not quite at 100%', () => {
    expect(limitResetAfter(limits(window(98, '2026-10-16T01:00:00.000Z'), '2026-10-15T23:25:00.000Z'), HIT)).toBe('2026-10-16T01:00:00.000Z')
  })

  it('knows nothing from limits taken before the limit', () => {
    expect(limitResetAfter(limits(window(98, '2026-10-16T01:00:00.000Z'), '2026-10-15T23:20:00.000Z'), HIT)).toBeNull()
    expect(limitResetAfter(null, HIT)).toBeNull()
  })

  it('sees the reset in a five-hour window that started after the limit', () => {
    expect(limitResetAfter(limits(window(3, '2026-10-16T09:30:00.000Z'), '2026-10-16T04:40:00.000Z'), HIT)).toBe('2026-10-16T04:30:00.000Z')
  })

  it('sees the reset in a five-hour window that /usage reports as not started', () => {
    expect(limitResetAfter(limits(null, '2026-10-16T05:01:14.834Z'), HIT)).toBe('2026-10-16T05:01:14.834Z')
  })

  it('does not take a statusline snapshot without the five-hour window for a reset', () => {
    expect(limitResetAfter(limits(null, '2026-10-16T00:22:00.400Z', 'statusline'), HIT)).toBeNull()
  })
})
