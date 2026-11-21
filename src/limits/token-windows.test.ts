import { describe, expect, it } from 'vitest'
import type { LimitWindow, RateLimits } from './model.js'
import { tokenWindowsDiffer } from './token-windows.js'

const RESET = '2026-11-17T13:00:00.000Z'
const WEEK = '2026-11-20T09:00:00.000Z'
const of = (at: string, fiveHour: LimitWindow | null, source: RateLimits['source'], sevenDay: LimitWindow | null = { usedPercentage: 40, resetsAt: WEEK }): RateLimits => ({
  fiveHour,
  sevenDay,
  updatedAt: at,
  source,
})

describe('tokenWindowsDiffer', () => {
  it('finds no difference in the same windows, a reset named to the hour and usage grown since the poll', () => {
    const poll = of('2026-11-17T10:00:00.000Z', { usedPercentage: 20, resetsAt: '2026-11-17T13:00:00.000Z' }, 'usage')
    const token = of('2026-11-17T10:20:00.000Z', { usedPercentage: 34, resetsAt: '2026-11-17T12:41:17.000Z' }, 'sdk', { usedPercentage: 42, resetsAt: WEEK })
    expect(tokenWindowsDiffer(token, poll)).toBeUndefined()
  })

  it('names a window whose reset stands more than an hour off the poll', () => {
    const poll = of('2026-11-17T10:00:00.000Z', { usedPercentage: 20, resetsAt: RESET }, 'usage')
    const token = of('2026-11-17T10:05:00.000Z', { usedPercentage: 20, resetsAt: '2026-11-17T14:30:00.000Z' }, 'sdk')
    expect(tokenWindowsDiffer(token, poll)).toBe('fiveHour')
  })

  it('names a window whose later reading spent less than the earlier one by more than the tolerance', () => {
    const poll = of('2026-11-17T10:10:00.000Z', { usedPercentage: 15, resetsAt: RESET }, 'usage')
    const token = of('2026-11-17T10:00:00.000Z', { usedPercentage: 30, resetsAt: RESET }, 'sdk')
    expect(tokenWindowsDiffer(token, poll)).toBe('fiveHour')
    const week = of('2026-11-17T10:10:00.000Z', null, 'sdk', { usedPercentage: 10, resetsAt: WEEK })
    expect(tokenWindowsDiffer(week, of('2026-11-17T10:00:00.000Z', null, 'usage'))).toBe('sevenDay')
  })

  it('passes over a window that ended before the other reading, and a window one side lacks', () => {
    const poll = of('2026-11-17T10:00:00.000Z', { usedPercentage: 90, resetsAt: '2026-11-17T10:30:00.000Z' }, 'usage')
    const token = of('2026-11-17T11:00:00.000Z', { usedPercentage: 2, resetsAt: '2026-11-17T16:00:00.000Z' }, 'sdk')
    expect(tokenWindowsDiffer(token, poll)).toBeUndefined()
    expect(tokenWindowsDiffer(of('2026-11-17T10:05:00.000Z', null, 'sdk'), of('2026-11-17T10:00:00.000Z', { usedPercentage: 20, resetsAt: RESET }, 'usage'))).toBeUndefined()
  })
})
