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

  it("reads Codex's refusal in the local zone, dated with a year or a bare time of the same day", () => {
    const refusal = 'You’ve hit your usage limit. To continue using Codex, start a free trial of Plus today, or try again at Nov 16th, 2026 10:12 PM.'
    expect(resetTimeOf(refusal, '2026-10-25T12:00:00.000Z')).toBe(new Date(2026, 10, 16, 22, 12).toISOString())
    expect(resetTimeOf('try again at Jan 2nd, 2027 9:05 AM.', '2026-12-30T12:00:00.000Z')).toBe(new Date(2027, 0, 2, 9, 5).toISOString())
    const at = new Date(2026, 9, 25, 9, 0).toISOString()
    expect(resetTimeOf("You've hit your usage limit. Upgrade to Pro, or try again at 3:46 PM.", at)).toBe(new Date(2026, 9, 25, 15, 46).toISOString())
  })

  it('gives up on text without a reset time or with an unknown zone', () => {
    expect(resetTimeOf('API Error: 529 overloaded', '2026-09-27T14:39:02.453Z')).toBeNull()
    expect(resetTimeOf('resets 7pm (Mars/Olympus)', '2026-09-27T14:39:02.453Z')).toBeNull()
  })
})
