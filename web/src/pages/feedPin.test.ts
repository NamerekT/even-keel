import { describe, expect, it } from 'vitest'
import { afterScroll } from './feedPin.js'

describe('afterScroll', () => {
  it('puts a pinned feed at its end again when content grew before the scroll event came', () => {
    // The feed was put at 1863; by the event the content is 385 px taller.
    expect(afterScroll(true, false, 1863, 1863, 385)).toBe('end')
  })

  it('puts a pinned feed at its end again when the browser moved it up with no input of the reader', () => {
    // The box was taller for a moment, the position was clamped to 1183, then the box shrank back (BTN-1372).
    expect(afterScroll(true, false, 1183, 1212, 25)).toBe('end')
  })

  it('stays pinned at its end', () => {
    expect(afterScroll(true, false, 2305, 2305, 0)).toBe('pinned')
  })

  it('lets the reader go up from a pinned feed', () => {
    expect(afterScroll(true, true, 1500, 1863, 400)).toBe('free')
  })

  it('keeps a pinned feed at its end when the reader scrolls while content grows under them', () => {
    expect(afterScroll(true, true, 1863, 1863, 385)).toBe('end')
  })

  it('keeps a feed pinned when the reader moves up less than the slack', () => {
    expect(afterScroll(true, true, 1855, 1863, 10)).toBe('pinned')
  })

  it('pins a free feed the reader brought back to its end', () => {
    expect(afterScroll(false, true, 2300, 1500, 5)).toBe('pinned')
  })

  it('leaves a free feed free far from its end, input or not', () => {
    expect(afterScroll(false, true, 2000, 1500, 300)).toBe('free')
    expect(afterScroll(false, false, 2000, 1500, 300)).toBe('free')
  })
})
