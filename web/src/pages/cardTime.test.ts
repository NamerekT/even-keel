import { describe, expect, it } from 'vitest'
import { cardTimeOf } from './cardTime.js'

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
