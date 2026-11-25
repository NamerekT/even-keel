import { describe, expect, it } from 'vitest'
import { afterScroll, feedRaised } from './feedPin.js'

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

describe('feedRaised', () => {
  it('stays down while the feed is pinned, however far the gap', () => {
    expect(feedRaised(false, true, 400)).toBe(false)
  })

  it('stays down when the reader left the end by less than the margin', () => {
    // A field that shrank by three lines here would bring the end back into the slack and pin the feed again.
    expect(feedRaised(false, false, 60)).toBe(false)
  })

  it('rises once the reader took the feed up past the margin', () => {
    expect(feedRaised(false, false, 200)).toBe(true)
  })

  it('stays raised while the feed is free, even back inside the margin', () => {
    expect(feedRaised(true, false, 40)).toBe(true)
  })

  it('comes down when the feed is pinned again', () => {
    expect(feedRaised(true, true, 0)).toBe(false)
  })
})
