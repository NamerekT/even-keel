import { describe, expect, it } from 'vitest'
import { formatAgo, formatSpan, plural } from './format.js'

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
