import { describe, expect, it } from 'vitest'
import { costChange, entrypointLabel, formatShare, formatUsd, kindLabel, launchLabel, modelLabel, reasonLabel, weeklyLimit } from './format.js'

describe('formatUsd', () => {
  it('keeps cents below a hundred and rounds above', () => {
    expect(formatUsd(0)).toBe('$0')
    expect(formatUsd(0.004)).toBe('< $0.01')
    expect(formatUsd(3.456)).toBe('$3.46')
    expect(formatUsd(638.03)).toBe('$638')
    expect(formatUsd(1234.5)).toBe('$1 235')
  })
})

describe('costChange', () => {
  it('compares with the previous period', () => {
    expect(costChange(110, 100)).toBe('+10 %')
    expect(costChange(638.03, 726.12)).toBe('−12 %')
    expect(costChange(100, 100)).toBe('±0 %')
  })

  it('says nothing without a previous period', () => {
    expect(costChange(50, 0)).toBeNull()
  })
})

describe('formatShare', () => {
  it('shows a percentage of the limit window', () => {
    expect(formatShare(21.43)).toBe('21 %')
    expect(formatShare(0.4)).toBe('< 1 %')
    expect(formatShare(null)).toBe('—')
  })
})

describe('labels', () => {
  it('names classifier reasons and the missing one', () => {
    expect(reasonLabel('debug_loop')).toBe('отладка по кругу')
    expect(reasonLabel(null)).toBe('не разобрано')
    expect(reasonLabel('brand_new')).toBe('brand_new')
  })

  it('names sign kinds', () => {
    expect(kindLabel('no_commit')).toBe('без коммита')
    expect(kindLabel('brand_new')).toBe('brand_new')
  })

  it('names models and entry points', () => {
    expect(modelLabel('opus')).toBe('Opus')
    expect(modelLabel('other')).toBe('другие')
    expect(entrypointLabel('baton')).toBe('Батон')
    expect(entrypointLabel('desktop')).toBe('приложение')
    expect(entrypointLabel('tally-classify')).toBe('Tally')
    expect(entrypointLabel('brand_new')).toBe('brand_new')
  })

  it('names launch reasons and sessions outside the chain', () => {
    expect(launchLabel('checkpoint')).toBe('контрольная точка')
    expect(launchLabel(null)).toBe('вне цепочки')
  })
})

describe('weeklyLimit', () => {
  it('sums a week or less and averages longer periods per week', () => {
    expect(weeklyLimit(63, 7)).toEqual({ share: 63, perWeek: false })
    expect(weeklyLimit(20, 1)).toEqual({ share: 20, perWeek: false })
    expect(weeklyLimit(180, 30)).toEqual({ share: 42, perWeek: true })
    expect(weeklyLimit(null, 30)).toEqual({ share: null, perWeek: true })
  })
})
