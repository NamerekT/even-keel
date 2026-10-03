import { describe, expect, it } from 'vitest'
import {
  addMonths,
  autoStep,
  bucketOf,
  buckets,
  dayCount,
  formatRange,
  localDay,
  previousRange,
  resolvePeriod,
  shiftRange,
} from './period.js'

const TODAY = '2026-10-03'

describe('localDay', () => {
  it('takes the local calendar day', () => {
    expect(localDay(new Date(2026, 9, 3, 23, 59))).toBe('2026-10-03')
    expect(localDay(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01')
  })
})

describe('addMonths', () => {
  it('keeps the day or falls back to the end of a shorter month', () => {
    expect(addMonths('2026-10-03', -3)).toBe('2026-07-03')
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29')
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15')
  })
})

describe('resolvePeriod', () => {
  it('counts sliding presets back from today, today included', () => {
    expect(resolvePeriod({ preset: '7d' }, TODAY, null)).toEqual({ from: '2026-09-27', to: TODAY })
    expect(resolvePeriod({ preset: '30d' }, TODAY, null)).toEqual({ from: '2026-09-04', to: TODAY })
    expect(resolvePeriod({ preset: '3m' }, TODAY, null)).toEqual({ from: '2026-07-04', to: TODAY })
  })

  it('takes calendar presets', () => {
    expect(resolvePeriod({ preset: 'month' }, TODAY, null)).toEqual({ from: '2026-10-01', to: TODAY })
    expect(resolvePeriod({ preset: 'last-month' }, TODAY, null)).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(resolvePeriod({ preset: 'last-month' }, '2026-01-10', null)).toEqual({ from: '2025-12-01', to: '2025-12-31' })
    expect(resolvePeriod({ preset: 'year' }, TODAY, null)).toEqual({ from: '2026-01-01', to: TODAY })
  })

  it('starts all time at the first day with data', () => {
    expect(resolvePeriod({ preset: 'all' }, TODAY, '2024-05-17')).toEqual({ from: '2024-05-17', to: TODAY })
    expect(resolvePeriod({ preset: 'all' }, TODAY, null)).toEqual({ from: TODAY, to: TODAY })
  })

  it('keeps a custom range as it is', () => {
    expect(resolvePeriod({ from: '2025-02-03', to: '2025-02-09' }, TODAY, null)).toEqual({ from: '2025-02-03', to: '2025-02-09' })
  })
})

describe('shiftRange', () => {
  it('moves a range of days by its length', () => {
    expect(shiftRange({ from: '2026-09-04', to: TODAY }, -1, TODAY)).toEqual({ from: '2026-08-05', to: '2026-09-03' })
    expect(shiftRange({ from: '2026-08-05', to: '2026-09-03' }, 1, TODAY)).toEqual({ from: '2026-09-04', to: TODAY })
  })

  it('does not run past today', () => {
    expect(shiftRange({ from: '2026-09-20', to: '2026-09-29' }, 1, TODAY)).toEqual({ from: '2026-09-24', to: TODAY })
  })

  it('moves whole months by months', () => {
    expect(shiftRange({ from: '2026-09-01', to: '2026-09-30' }, -1, TODAY)).toEqual({ from: '2026-08-01', to: '2026-08-31' })
    expect(shiftRange({ from: '2026-01-01', to: '2026-03-31' }, -1, TODAY)).toEqual({ from: '2025-10-01', to: '2025-12-31' })
    expect(shiftRange({ from: '2026-08-01', to: '2026-08-31' }, 1, TODAY)).toEqual({ from: '2026-09-01', to: '2026-09-30' })
  })

  it('treats the month so far as the whole month', () => {
    expect(shiftRange({ from: '2026-10-01', to: TODAY }, -1, TODAY)).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(shiftRange({ from: '2026-09-01', to: '2026-09-30' }, 1, TODAY)).toEqual({ from: '2026-10-01', to: TODAY })
  })

  it('moves whole years and the year so far by years', () => {
    expect(shiftRange({ from: '2026-01-01', to: TODAY }, -1, TODAY)).toEqual({ from: '2025-01-01', to: '2025-12-31' })
    expect(shiftRange({ from: '2025-01-01', to: '2025-12-31' }, 1, TODAY)).toEqual({ from: '2026-01-01', to: TODAY })
  })
})

describe('previousRange', () => {
  it('is as long and ends the day before', () => {
    expect(previousRange({ from: '2026-09-27', to: TODAY })).toEqual({ from: '2026-09-20', to: '2026-09-26' })
    expect(previousRange({ from: '2026-03-01', to: '2026-03-01' })).toEqual({ from: '2026-02-28', to: '2026-02-28' })
  })
})

describe('autoStep', () => {
  it('goes by days up to about two months, by weeks up to a year, by months beyond', () => {
    expect(autoStep({ from: TODAY, to: TODAY })).toBe('day')
    expect(autoStep({ from: '2026-08-03', to: TODAY })).toBe('day')
    expect(autoStep({ from: '2026-08-02', to: TODAY })).toBe('week')
    expect(autoStep({ from: '2025-10-03', to: TODAY })).toBe('week')
    expect(autoStep({ from: '2025-10-02', to: TODAY })).toBe('month')
  })
})

describe('buckets', () => {
  it('starts a week on Monday and a month on the first', () => {
    expect(bucketOf('2026-10-03', 'week')).toBe('2026-09-28')
    expect(bucketOf('2026-09-28', 'week')).toBe('2026-09-28')
    expect(bucketOf('2026-10-03', 'month')).toBe('2026-10-01')
    expect(bucketOf('2026-10-03', 'day')).toBe('2026-10-03')
  })

  it('lists every bucket the range touches', () => {
    expect(buckets({ from: '2026-09-30', to: TODAY }, 'day')).toEqual(['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'])
    expect(buckets({ from: '2026-09-20', to: TODAY }, 'week')).toEqual(['2026-09-14', '2026-09-21', '2026-09-28'])
    expect(buckets({ from: '2025-12-20', to: '2026-02-01' }, 'month')).toEqual(['2025-12-01', '2026-01-01', '2026-02-01'])
  })
})

describe('dayCount', () => {
  it('counts both ends', () => {
    expect(dayCount({ from: TODAY, to: TODAY })).toBe(1)
    expect(dayCount({ from: '2026-03-28', to: '2026-03-30' })).toBe(3)
  })
})

describe('formatRange', () => {
  it('names the year once when both ends share it', () => {
    expect(formatRange({ from: '2026-09-04', to: TODAY })).toBe('4 сент — 3 окт 2026')
    expect(formatRange({ from: '2025-12-20', to: '2026-01-05' })).toBe('20 дек 2025 — 5 янв 2026')
    expect(formatRange({ from: TODAY, to: TODAY })).toBe('3 окт 2026')
  })
})
