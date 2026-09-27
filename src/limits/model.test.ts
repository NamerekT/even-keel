import { describe, expect, it } from 'vitest'
import { currentLimits, exhaustedReset, parseLimitsFile } from './model.js'

const RECEIVED_AT = '2026-01-01T12:00:00.000Z'
const FIVE_HOUR_RESET = Date.UTC(2026, 0, 1, 15, 0, 0) / 1000
const SEVEN_DAY_RESET = Date.UTC(2026, 0, 5, 9, 30, 0) / 1000

function snapshot(rateLimits: unknown, receivedAt = RECEIVED_AT): unknown {
  return { receivedAt, rate_limits: rateLimits }
}

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
      updatedAt: RECEIVED_AT,
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

    expect(limits).toEqual({ fiveHour: null, sevenDay: null, updatedAt: RECEIVED_AT })
  })

  it('ignores the spend_limit window', () => {
    const limits = parseLimitsFile(snapshot({ spend_limit: { used_percentage: 120, resets_at: SEVEN_DAY_RESET } }))

    expect(limits).toEqual({ fiveHour: null, sevenDay: null, updatedAt: RECEIVED_AT })
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
    updatedAt: RECEIVED_AT,
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

describe('exhaustedReset', () => {
  const window = (usedPercentage: number, resetsAt: string) => ({ usedPercentage, resetsAt })

  it('takes the latest reset among the exhausted windows', () => {
    const limits = {
      fiveHour: window(100, '2026-09-27T17:00:00.000Z'),
      sevenDay: window(100, '2026-09-30T08:00:00.000Z'),
      updatedAt: RECEIVED_AT,
    }
    expect(exhaustedReset(limits)).toBe('2026-09-30T08:00:00.000Z')
  })

  it('knows nothing when no window is exhausted', () => {
    expect(exhaustedReset({ fiveHour: window(71, '2026-09-27T17:00:00.000Z'), sevenDay: null, updatedAt: RECEIVED_AT })).toBeNull()
    expect(exhaustedReset(null)).toBeNull()
  })
})
