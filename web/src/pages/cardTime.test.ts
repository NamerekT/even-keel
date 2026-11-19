import { describe, expect, it } from 'vitest'
import { cardTimeOf, estimateMinutes } from './cardTime.js'

describe('cardTimeOf', () => {
  it('shows the estimate in minutes and the time in seconds in the same units', () => {
    expect(cardTimeOf(20, 1500)).toEqual({ estimate: '20 min', time: '25 min', over: false })
  })

  it('marks a time over one and a half estimates', () => {
    expect(cardTimeOf(20, 20 * 60 * 1.5)?.over).toBe(false)
    expect(cardTimeOf(20, 20 * 60 * 1.5 + 60)?.over).toBe(true)
  })

  it('shows a dash for the one that is missing', () => {
    expect(cardTimeOf(null, 600)).toEqual({ estimate: '—', time: '10 min', over: false })
    expect(cardTimeOf(40, undefined)).toEqual({ estimate: '40 min', time: '—', over: false })
  })

  it('gives no row when neither is known', () => {
    expect(cardTimeOf(undefined, null)).toBeNull()
  })
})

describe('estimateMinutes', () => {
  it('reads plain minutes, hours and minutes, and fractional hours in either language', () => {
    expect(estimateMinutes('20')).toBe(20)
    expect(estimateMinutes(' 1ч 20м ')).toBe(80)
    expect(estimateMinutes('1,5ч')).toBe(90)
    expect(estimateMinutes('1.5 h')).toBe(90)
    expect(estimateMinutes('2h30m')).toBe(150)
    expect(estimateMinutes('45 мин')).toBe(45)
    expect(estimateMinutes('45min')).toBe(45)
    expect(estimateMinutes('1 час')).toBe(60)
  })

  it('takes an empty field as no estimate', () => {
    expect(estimateMinutes('')).toBeNull()
    expect(estimateMinutes('   ')).toBeNull()
  })

  it('refuses what it cannot read, a negative or a zero', () => {
    for (const text of ['soon', '1ч ч', '-5', '0', 'ч', '20 20', '1м 1ч']) expect(estimateMinutes(text)).toBeUndefined()
  })
})
