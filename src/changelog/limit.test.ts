import { describe, expect, it } from 'vitest'
import type { RateLimits } from '../limits/model.js'
import { limitRefusalIn, spentLimitOf } from './limit.js'

const NOW = new Date('2026-11-17T10:00:00.000Z')
const window = (usedPercentage: number, resetsAt: string) => ({ usedPercentage, resetsAt })
const limits = (over: Partial<RateLimits>): RateLimits => ({ fiveHour: null, sevenDay: null, updatedAt: '2026-11-17T09:55:00.000Z', source: 'usage', ...over })

describe('spentLimitOf', () => {
  it('names the spent window and its reset', () => {
    expect(spentLimitOf(limits({ fiveHour: window(100, '2026-11-17T11:20:00.000Z'), sevenDay: window(40, '2026-11-20T08:00:00.000Z') }), NOW)).toEqual({
      window: 'fiveHour',
      until: '2026-11-17T11:20:00.000Z',
    })
  })

  it('takes the window that resets last when several are spent', () => {
    const spent = limits({ fiveHour: window(100, '2026-11-17T11:20:00.000Z'), sevenDay: window(100, '2026-11-20T08:00:00.000Z') })
    expect(spentLimitOf(spent, NOW)).toEqual({ window: 'sevenDay', until: '2026-11-20T08:00:00.000Z' })
  })

  it('counts a spent month', () => {
    expect(spentLimitOf(limits({ month: window(100, '2026-12-01T00:00:00.000Z') }), NOW)).toEqual({ window: 'month', until: '2026-12-01T00:00:00.000Z' })
  })

  it('passes over a window whose reset has already come', () => {
    expect(spentLimitOf(limits({ fiveHour: window(100, '2026-11-17T09:00:00.000Z') }), NOW)).toBeNull()
  })

  it('is null for free windows and unknown limits', () => {
    expect(spentLimitOf(limits({ fiveHour: window(99, '2026-11-17T11:20:00.000Z') }), NOW)).toBeNull()
    expect(spentLimitOf(null, NOW)).toBeNull()
  })
})

describe('limitRefusalIn', () => {
  it('reads a Claude CLI refusal on the 5-hour limit', () => {
    const text =
      'exited with 1: {"type":"result","subtype":"success","is_error":true,"api_error_status":429,"api_error":"usage_limit_reached",' +
      '"result":"You\'ve hit your 5-hour limit · resets 12:20pm (Europe/Berlin)","uuid":"00000000-0000-0000-0000-000000000000"}'
    expect(limitRefusalIn(text)).toEqual({ window: 'fiveHour' })
  })

  it('names the weekly window', () => {
    expect(limitRefusalIn('exited with 1: {"api_error_status":429,"result":"You\'ve hit your weekly limit · resets Nov 20"}')).toEqual({ window: 'sevenDay' })
  })

  it('takes a usage limit without a window it can tell', () => {
    expect(limitRefusalIn('exited with 1: ERROR: You have hit your usage limit. Try again later.')).toEqual({})
  })

  it('is null for any other failure', () => {
    expect(limitRefusalIn('timed out after 600000 ms')).toBeNull()
    expect(limitRefusalIn('exited with 1: {"api_error_status":500,"result":"Internal server error"}')).toBeNull()
  })
})
