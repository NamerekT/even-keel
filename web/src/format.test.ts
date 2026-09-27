import { describe, expect, it } from 'vitest'
import { formatAgo, formatClock, formatMoment, formatSpan, formatTokens, plural } from './format.js'

const now = new Date('2026-01-01T12:00:00.000Z')
const later = (ms: number) => new Date(now.getTime() + ms).toISOString()
const earlier = (ms: number) => new Date(now.getTime() - ms).toISOString()

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe('formatSpan', () => {
  it('shows days and hours past a day', () => {
    expect(formatSpan(later(3 * DAY + 4 * HOUR + 20 * MIN), now)).toBe('3 д 4 ч')
  })

  it('drops zero hours after days', () => {
    expect(formatSpan(later(2 * DAY + 10 * MIN), now)).toBe('2 д')
  })

  it('shows hours and minutes under a day', () => {
    expect(formatSpan(later(2 * HOUR + 14 * MIN + 30_000), now)).toBe('2 ч 14 мин')
  })

  it('drops zero minutes after hours', () => {
    expect(formatSpan(later(5 * HOUR), now)).toBe('5 ч')
  })

  it('shows minutes under an hour', () => {
    expect(formatSpan(later(12 * MIN + 59_000), now)).toBe('12 мин')
  })

  it('shows under a minute for the last seconds and for a moment already past', () => {
    expect(formatSpan(later(30_000), now)).toBe('< 1 мин')
    expect(formatSpan(earlier(5_000), now)).toBe('< 1 мин')
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

describe('plural', () => {
  const launches = (count: number) => plural(count, 'запуск', 'запуска', 'запусков')

  it('picks the Russian form by the last digits', () => {
    expect([0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111, 112].map(launches)).toEqual([
      'запусков',
      'запуск',
      'запуска',
      'запуска',
      'запусков',
      'запусков',
      'запусков',
      'запусков',
      'запуск',
      'запуска',
      'запусков',
      'запуск',
      'запусков',
      'запусков',
    ])
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
