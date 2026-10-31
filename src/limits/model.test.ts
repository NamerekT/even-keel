import { describe, expect, it } from 'vitest'
import { currentLimits, exhaustedReset, limitReopenedAt, limitResetAfter,limitsFileDir, limitsOfRateLimitInfo, limitSpans, newestLimits, parseLimitsFile, withSessionLimits } from './model.js'

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

  it('drops a spent month but keeps the plan monthly', () => {
    const monthly = { fiveHour: null, sevenDay: null, month: { usedPercentage: 12, resetsAt: '2026-01-20T00:00:00.000Z' }, updatedAt: RECEIVED_AT, source: 'usage' as const }
    expect(currentLimits(monthly, new Date('2026-01-19T00:00:00.000Z'))).toEqual(monthly)
    expect(currentLimits(monthly, new Date('2026-01-21T00:00:00.000Z'))).toEqual({ ...monthly, month: null })
    expect(currentLimits(limits, new Date('2026-01-01T14:00:00.000Z'))).not.toHaveProperty('month')
  })
})

describe('limitSpans', () => {
  const window = { usedPercentage: 1, resetsAt: '2026-01-20T00:00:00.000Z' }

  it('shows the five-hour and the weekly window by default, with or without data', () => {
    expect(limitSpans(null)).toEqual(['fiveHour', 'sevenDay'])
    expect(limitSpans({ fiveHour: null, sevenDay: window, updatedAt: RECEIVED_AT, source: 'usage' })).toEqual(['fiveHour', 'sevenDay'])
  })

  it('shows only the month for a monthly plan, even once it reset', () => {
    expect(limitSpans({ fiveHour: null, sevenDay: null, month: window, updatedAt: RECEIVED_AT, source: 'usage' })).toEqual(['month'])
    expect(limitSpans({ fiveHour: null, sevenDay: null, month: null, updatedAt: RECEIVED_AT, source: 'usage' })).toEqual(['month'])
  })

  it('puts the month after the windows a plan has besides it', () => {
    expect(limitSpans({ fiveHour: window, sevenDay: null, month: window, updatedAt: RECEIVED_AT, source: 'usage' })).toEqual(['fiveHour', 'month'])
  })

  it('leaves out a window the provider\'s own answer does not have, as ChatGPT Pro has no five hours', () => {
    expect(limitSpans({ fiveHour: null, sevenDay: window, updatedAt: RECEIVED_AT, source: 'api' })).toEqual(['sevenDay'])
    expect(limitSpans({ fiveHour: null, sevenDay: null, updatedAt: RECEIVED_AT, source: 'api' })).toEqual(['fiveHour', 'sevenDay'])
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

  it('counts a spent month', () => {
    expect(exhaustedReset({ fiveHour: null, sevenDay: null, month: window(100, '2026-10-28T21:15:48.000Z'), updatedAt: RECEIVED_AT, source: 'usage' })).toBe(
      '2026-10-28T21:15:48.000Z',
    )
  })

  it('knows nothing when no window is exhausted', () => {
    expect(exhaustedReset({ fiveHour: window(71, '2026-09-27T17:00:00.000Z'), sevenDay: null, updatedAt: RECEIVED_AT, source: 'statusline' as const })).toBeNull()
    expect(exhaustedReset(null)).toBeNull()
  })
})

describe('limitReopenedAt', () => {
  const HIT = '2026-10-28T09:00:00.000Z'
  const NAMED = '2026-11-01T08:00:00.000Z'
  const POLLED = '2026-10-28T10:00:00.000Z'
  const window = (usedPercentage: number, resetsAt: string) => ({ usedPercentage, resetsAt })
  const chatGpt = (open: boolean | undefined, updatedAt = POLLED) => ({
    fiveHour: window(0, '2026-10-28T15:00:00.000Z'),
    sevenDay: window(0, '2026-11-04T10:00:00.000Z'),
    updatedAt,
    source: 'api' as const,
    ...(open !== undefined && { open }),
  })
  const claude = (fiveHour: ReturnType<typeof window> | null, sevenDay: ReturnType<typeof window> | null, source: 'usage' | 'statusline' | 'sdk' = 'usage') =>
    ({ fiveHour, sevenDay, updatedAt: POLLED, source })

  it('takes a ChatGPT answer that allows requests again as the window open from that answer', () => {
    expect(limitReopenedAt(chatGpt(true), HIT, NAMED)).toBe(POLLED)
  })

  it('keeps waiting on a ChatGPT answer that is still spent or does not say', () => {
    expect(limitReopenedAt(chatGpt(false), HIT, NAMED)).toBeNull()
    expect(limitReopenedAt(chatGpt(undefined), HIT, NAMED)).toBeNull()
  })

  it('waits for the named reset when a reading comes just before it', () => {
    // Live 2026-10-31: /usage showed the five-hour window unstarted at 00:48:05, the CLI refused until 00:50.
    const named = '2026-10-31T00:50:00.000Z'
    const hit = '2026-10-30T21:08:11.299Z'
    const reading = (updatedAt: string) => ({ fiveHour: null, sevenDay: window(14, '2026-11-06T15:00:00.000Z'), updatedAt, source: 'usage' as const })
    expect(limitReopenedAt(reading('2026-10-31T00:48:05.221Z'), hit, named)).toBeNull()
    expect(limitReopenedAt({ ...chatGpt(true), updatedAt: '2026-10-31T00:45:00.000Z' }, hit, named)).toBeNull()
    expect(limitReopenedAt(reading('2026-10-31T00:30:00.000Z'), hit, named)).toBe('2026-10-31T00:30:00.000Z')
  })

  it('ignores an answer taken before the refusal or none at all', () => {
    expect(limitReopenedAt(chatGpt(true, '2026-10-28T08:55:00.000Z'), HIT, NAMED)).toBeNull()
    expect(limitReopenedAt(chatGpt(true, HIT), HIT, NAMED)).toBeNull()
    expect(limitReopenedAt(null, HIT, NAMED)).toBeNull()
  })

  it('takes a Claude /usage reading whose spent window started over before the named reset', () => {
    expect(limitReopenedAt(claude(window(0, '2026-10-28T15:00:00.000Z'), window(2, '2026-11-04T10:00:00.000Z')), HIT, NAMED)).toBe(POLLED)
    expect(limitReopenedAt(claude(null, null), HIT, NAMED)).toBe(POLLED)
  })

  it('keeps waiting while a Claude window is spent or still runs out at the named reset', () => {
    expect(limitReopenedAt(claude(window(0, '2026-10-28T15:00:00.000Z'), window(100, '2026-11-04T10:00:00.000Z')), HIT, NAMED)).toBeNull()
    expect(limitReopenedAt(claude(window(10, '2026-10-28T15:00:00.000Z'), window(97, '2026-11-01T08:00:00.000Z')), HIT, NAMED)).toBeNull()
    expect(limitReopenedAt(claude(window(10, '2026-10-28T15:00:00.000Z'), window(97, '2026-11-01T08:40:00.000Z')), HIT, NAMED)).toBeNull()
  })

  it('does not read a statusline or a session event as a poll', () => {
    expect(limitReopenedAt(claude(null, window(2, '2026-11-04T10:00:00.000Z'), 'statusline'), HIT, NAMED)).toBeNull()
    expect(limitReopenedAt(claude(null, window(2, '2026-11-04T10:00:00.000Z'), 'sdk'), HIT, NAMED)).toBeNull()
  })

  it('leaves a counted allowance with no open flag to its own path', () => {
    const copilot = { fiveHour: null, sevenDay: null, month: { usedPercentage: 10, resetsAt: '2026-11-01T00:00:00.000Z', left: 270 }, updatedAt: POLLED, source: 'api' as const }
    expect(limitReopenedAt(copilot, HIT, NAMED)).toBeNull()
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

  it('waits for the end of the month on a monthly plan that is not quite at 100%', () => {
    const monthly = { fiveHour: null, sevenDay: null, month: window(98, '2026-10-28T21:15:48.000Z'), updatedAt: '2026-10-16T00:00:00.000Z', source: 'usage' as const }
    expect(limitResetAfter(monthly, HIT)).toBe('2026-10-28T21:15:48.000Z')
    expect(limitResetAfter({ ...monthly, month: null }, HIT)).toBeNull()
  })

  it('goes on at once when a counted monthly allowance polled after the limit still has some left', () => {
    const allowance = { fiveHour: null, sevenDay: null, month: { ...window(60, '2026-11-01T00:00:00.000Z'), left: 120 }, updatedAt: '2026-10-16T00:00:00.000Z', source: 'api' as const }
    expect(limitResetAfter(allowance, HIT)).toBe('2026-10-16T00:00:00.000Z')
    expect(limitResetAfter({ ...allowance, month: { ...window(100, '2026-11-01T00:00:00.000Z'), left: 0 } }, HIT)).toBe('2026-11-01T00:00:00.000Z')
  })

  it('does not take a statusline snapshot without the five-hour window for a reset', () => {
    expect(limitResetAfter(limits(null, '2026-10-16T00:22:00.400Z', 'statusline'), HIT)).toBeNull()
  })
})

describe('limitsOfRateLimitInfo', () => {
  // CLI 2.1.308 through SDK 0.3.308, seen live: `unifiedWindows` is not in `sdk.d.ts`.
  const live = {
    status: 'allowed_warning',
    resetsAt: 1793286000,
    rateLimitType: 'seven_day',
    utilization: 0.45,
    overageStatus: 'rejected',
    isUsingOverage: false,
    unifiedWindows: { five_hour: { utilization: 0.6, resetsAt: 1792753800 }, seven_day: { utilization: 0.45, resetsAt: 1793286000 } },
  }

  it('reads both windows a session reports, the utilization as a share', () => {
    expect(limitsOfRateLimitInfo(live)).toEqual({
      overage: { source: 'claude-sdk', available: false, using: false },
      fiveHour: { usedPercentage: 60, resetsAt: '2026-10-23T11:10:00.000Z' },
      sevenDay: { usedPercentage: 45, resetsAt: '2026-10-29T15:00:00.000Z' },
    })
  })

  it('falls back to the one window the documented fields name', () => {
    const { unifiedWindows: _, ...documented } = live
    expect(limitsOfRateLimitInfo(documented)).toEqual({ overage: { source: 'claude-sdk', available: false, using: false }, sevenDay: { usedPercentage: 45, resetsAt: '2026-10-29T15:00:00.000Z' } })
  })

  it('takes a refused window without utilization for a spent one', () => {
    expect(limitsOfRateLimitInfo({ status: 'rejected', rateLimitType: 'five_hour', resetsAt: 1792753800 })).toEqual({
      fiveHour: { usedPercentage: 100, resetsAt: '2026-10-23T11:10:00.000Z' },
    })
  })

  it('reads nothing from a model window or a malformed event, and keeps overage availability', () => {
    expect(limitsOfRateLimitInfo({ status: 'allowed_warning', rateLimitType: 'seven_day_opus', utilization: 0.8, resetsAt: 1793286000 })).toBeUndefined()
    expect(limitsOfRateLimitInfo({ status: 'allowed', rateLimitType: 'overage' })).toEqual({ overage: { source: 'claude-sdk', available: true } })
    expect(limitsOfRateLimitInfo({ status: 'allowed' })).toBeUndefined()
    expect(limitsOfRateLimitInfo({ status: 'allowed', unifiedWindows: { five_hour: { utilization: 'high', resetsAt: 1792753800 } } })).toBeUndefined()
    expect(limitsOfRateLimitInfo(null)).toBeUndefined()
  })
})

describe('withSessionLimits', () => {
  const polled = {
    fiveHour: { usedPercentage: 20, resetsAt: '2026-01-01T15:00:00.000Z' },
    sevenDay: { usedPercentage: 30, resetsAt: '2026-01-05T09:30:00.000Z' },
    updatedAt: RECEIVED_AT,
    source: 'usage' as const,
  }

  it('puts the reported windows over what was known and keeps the rest', () => {
    const fiveHour = { usedPercentage: 25, resetsAt: '2026-01-01T15:00:00.000Z' }
    expect(withSessionLimits(polled, { fiveHour }, '2026-01-01T12:03:00.000Z')).toEqual({
      fiveHour,
      sevenDay: polled.sevenDay,
      updatedAt: '2026-01-01T12:03:00.000Z',
      source: 'sdk',
    })
  })

  it('leaves a window it knows nothing of empty', () => {
    const sevenDay = { usedPercentage: 31, resetsAt: '2026-01-05T09:30:00.000Z' }
    expect(withSessionLimits(undefined, { sevenDay }, RECEIVED_AT)).toEqual({ fiveHour: null, sevenDay, updatedAt: RECEIVED_AT, source: 'sdk' })
  })
})
