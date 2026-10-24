import { describe, expect, it } from 'vitest'
import { OPEN_DELAY_MS, openDelay, WARM_MS } from './useTip.js'

describe('openDelay', () => {
  it('waits when no tip was open', () => {
    expect(openDelay(10_000, 0, -Infinity)).toBe(OPEN_DELAY_MS)
  })

  it('opens at once while another tip is still open', () => {
    expect(openDelay(10_000, 1, -Infinity)).toBe(0)
  })

  it('opens at once when a tip closed within the warm window', () => {
    expect(openDelay(10_000, 0, 10_000 - WARM_MS)).toBe(0)
  })

  it('waits again once the warm window has passed', () => {
    expect(openDelay(10_000, 0, 10_000 - WARM_MS - 1)).toBe(OPEN_DELAY_MS)
  })
})
