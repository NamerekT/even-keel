import { describe, expect, it } from 'vitest'
import { resetTimeOf } from './reset.js'

describe('resetTimeOf', () => {
  it('reads a clock time in the named zone on the day of the limit', () => {
    expect(resetTimeOf("You've hit your session limit · resets 7:20pm (Europe/Berlin)", '2026-09-27T14:39:02.453Z')).toBe(
      '2026-09-27T17:20:00.000Z',
    )
  })

  it('rolls a time already passed that day over to the next day', () => {
    expect(resetTimeOf('resets 1am (Europe/Berlin)', '2026-09-27T21:00:00.000Z')).toBe('2026-09-27T23:00:00.000Z')
  })

  it('reads a dated reset with the offset of that date', () => {
    expect(resetTimeOf("You've hit your weekly limit · resets Oct 30, 9am (Europe/Berlin)", '2026-10-27T10:00:00.000Z')).toBe(
      '2026-10-30T08:00:00.000Z',
    )
  })

  it('reads 12am and 12pm', () => {
    expect(resetTimeOf('resets 12pm (UTC)', '2026-09-27T08:00:00.000Z')).toBe('2026-09-27T12:00:00.000Z')
    expect(resetTimeOf('resets 12am (UTC)', '2026-09-27T08:00:00.000Z')).toBe('2026-09-28T00:00:00.000Z')
  })

  it('gives up on text without a reset time or with an unknown zone', () => {
    expect(resetTimeOf('API Error: 529 overloaded', '2026-09-27T14:39:02.453Z')).toBeNull()
    expect(resetTimeOf('resets 7pm (Mars/Olympus)', '2026-09-27T14:39:02.453Z')).toBeNull()
  })
})
