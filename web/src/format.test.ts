import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { formatAgo, formatClock, formatElapsed, formatFullTime, formatLineTime, formatMoment, formatSpan, formatStamp, formatTokens, minuteMarks } from './format.js'
import { setLanguage } from './i18n/index.js'

setLanguage('ru')

const now = new Date('2026-01-01T12:00:00.000Z')
const later = (ms: number) => new Date(now.getTime() + ms).toISOString()
const earlier = (ms: number) => new Date(now.getTime() - ms).toISOString()

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe('formatSpan', () => {
  it('shows days and hours past a day, units against the numbers', () => {
    expect(formatSpan(later(3 * DAY + 4 * HOUR + 20 * MIN), now)).toBe('3д 4ч')
  })

  it('drops zero hours after days', () => {
    expect(formatSpan(later(2 * DAY + 10 * MIN), now)).toBe('2д')
  })

  it('shows hours and minutes under a day', () => {
    expect(formatSpan(later(2 * HOUR + 14 * MIN + 30_000), now)).toBe('2ч 14м')
  })

  it('drops zero minutes after hours', () => {
    expect(formatSpan(later(5 * HOUR), now)).toBe('5ч')
  })

  it('shows minutes under an hour', () => {
    expect(formatSpan(later(12 * MIN + 59_000), now)).toBe('12м')
  })

  it('shows under a minute for the last seconds and for a moment already past', () => {
    expect(formatSpan(later(30_000), now)).toBe('<1м')
    expect(formatSpan(earlier(5_000), now)).toBe('<1м')
  })
})

describe('formatAgo', () => {
  it('says just now for the first seconds and for a clock slightly ahead', () => {
    expect(formatAgo(earlier(4_000), now)).toBe('только что')
    expect(formatAgo(later(2_000), now)).toBe('только что')
  })

  it('counts seconds, then minutes, then hours, then days', () => {
    expect(formatAgo(earlier(12_000), now)).toBe('12 с назад')
    expect(formatAgo(earlier(3 * MIN + 40_000), now)).toBe('3 мин назад')
    expect(formatAgo(earlier(2 * HOUR + 50 * MIN), now)).toBe('2 ч назад')
    expect(formatAgo(earlier(3 * DAY + 5 * HOUR), now)).toBe('3 д назад')
  })
})

describe('in English', () => {
  beforeEach(() => setLanguage('en'))
  afterEach(() => setLanguage('ru'))

  it('uses English units', () => {
    expect(formatSpan(later(2 * HOUR + 14 * MIN + 30_000), now)).toBe('2h 14m')
    expect(formatAgo(earlier(4_000), now)).toBe('just now')
    expect(formatAgo(earlier(3 * MIN + 40_000), now)).toBe('3 min ago')
    expect(formatClock(2 * DAY + 3 * HOUR + 4 * MIN)).toBe('2 d 3:04:00')
  })

  it('formats dates in English', () => {
    const today = new Date(2026, 8, 27, 12, 0)
    expect(formatMoment(new Date(2026, 9, 3, 14, 59).toISOString(), today)).toMatch(/Oct 3/)
  })
})

describe('formatTokens', () => {
  it('keeps small counts whole and rounds the rest to thousands or millions', () => {
    expect(formatTokens(800)).toBe('800')
    expect(formatTokens(61_400)).toBe('61k')
    expect(formatTokens(599_600)).toBe('600k')
    expect(formatTokens(1_240_000)).toBe('1.2M')
    expect(formatTokens(2_000_000)).toBe('2M')
  })
})

describe('formatClock', () => {
  it('shows minutes and seconds under an hour', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(7_900)).toBe('0:07')
    expect(formatClock(42 * MIN + 13_000)).toBe('42:13')
  })

  it('adds hours past an hour and days past a day', () => {
    expect(formatClock(HOUR + 2 * MIN + 5_000)).toBe('1:02:05')
    expect(formatClock(2 * DAY + 3 * HOUR + 4 * MIN)).toBe('2 д 3:04:00')
  })

  it('never goes below zero when the clocks disagree', () => {
    expect(formatClock(-3_000)).toBe('0:00')
  })
})

describe('formatElapsed', () => {
  it('counts seconds, then minutes with seconds, then hours with minutes, units against the numbers', () => {
    expect(formatElapsed(23_400)).toBe('23с')
    expect(formatElapsed(MIN + 5_000)).toBe('1м 05с')
    expect(formatElapsed(2 * HOUR + 3 * MIN + 40_000)).toBe('2ч 03м')
  })

  it('never goes below zero when the clocks disagree', () => {
    expect(formatElapsed(-3_000)).toBe('0с')
  })
})

describe('formatMoment', () => {
  const today = new Date(2026, 8, 27, 12, 0)

  it('gives only the clock time for a moment later today', () => {
    expect(formatMoment(new Date(2026, 8, 27, 19, 49).toISOString(), today)).toBe('19:49')
  })

  it('adds the date for a moment on another day', () => {
    const text = formatMoment(new Date(2026, 9, 3, 14, 59).toISOString(), today)
    expect(text).toMatch(/3 окт/)
    expect(text).toMatch(/14:59/)
  })
})

describe('formatLineTime', () => {
  afterEach(() => setLanguage('ru'))

  it('is hours and minutes on a 24-hour clock, without seconds or AM/PM, in English too', () => {
    setLanguage('en')
    expect(formatLineTime(new Date(2026, 9, 30, 16, 5, 45).toISOString())).toBe('16:05')
  })
})

describe('formatStamp', () => {
  const today = new Date(2026, 9, 31, 12, 0)
  afterEach(() => setLanguage('ru'))

  it('gives only the time for a moment of today', () => {
    expect(formatStamp(new Date(2026, 9, 31, 8, 8).toISOString(), today)).toBe('08:08')
  })

  it('gives only a short date for an earlier day', () => {
    setLanguage('en')
    expect(formatStamp(new Date(2026, 9, 30, 8, 8).toISOString(), today)).toBe('Oct 30')
  })
})

describe('formatFullTime', () => {
  it('has the date and the seconds', () => {
    const text = formatFullTime(new Date(2026, 9, 30, 9, 29, 45).toISOString())
    expect(text).toMatch(/30 окт/)
    expect(text).toMatch(/09:29:45/)
  })
})

describe('minuteMarks', () => {
  const at = (minute: number, second: number) => new Date(2026, 9, 30, 9, minute, second).toISOString()

  it('marks a line whose minute differs from the line before, and the first', () => {
    expect(minuteMarks([at(29, 1), at(29, 40), at(30, 5), at(30, 6), at(31, 0)])).toEqual([true, false, true, false, true])
  })

  it('skips a line without a time and compares with the last line that had one', () => {
    expect(minuteMarks(['', at(29, 1), '', at(29, 40), at(32, 0)])).toEqual([false, true, false, false, true])
  })
})
