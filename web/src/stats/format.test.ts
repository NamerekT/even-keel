import { describe, expect, it } from 'vitest'
import {
  costChange,
  entrypointLabel,
  formatDuration,
  formatRatio,
  formatSeconds,
  formatShare,
  formatUsd,
  kindLabel,
  launchLabel,
  limitWindows,
  modelLabel,
  modelVersionLabel,
  reasonLabel,
  weeklyLimit,
} from './format.js'

describe('formatSeconds', () => {
  it('keeps a tenth below ten seconds, whole seconds below two minutes, then minutes', () => {
    expect(formatSeconds(null)).toBe('—')
    expect(formatSeconds(2.64)).toBe('2.6 с')
    expect(formatSeconds(35.4)).toBe('35 с')
    expect(formatSeconds(119)).toBe('119 с')
    expect(formatSeconds(201)).toBe('3.4 мин')
    expect(formatSeconds(1265)).toBe('21 мин')
    expect(formatSeconds(10_409)).toBe('2 ч 53 мин')
  })
})

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
    expect(formatShare(0)).toBe('0 %')
    expect(formatShare(null)).toBe('—')
  })
})

describe('formatDuration', () => {
  it('shows minutes below an hour, hours and minutes below ten hours, whole hours above', () => {
    expect(formatDuration(null)).toBe('—')
    expect(formatDuration(0)).toBe('0 мин')
    expect(formatDuration(20)).toBe('< 1 мин')
    expect(formatDuration(42 * 60 + 20)).toBe('42 мин')
    expect(formatDuration(3600)).toBe('1 ч')
    expect(formatDuration(3600 + 5 * 60)).toBe('1 ч 05 мин')
    expect(formatDuration(3 * 3600 + 59 * 60 + 50)).toBe('4 ч')
    expect(formatDuration(12.6 * 3600)).toBe('13 ч')
  })
})

describe('formatRatio', () => {
  it('shows fact against estimate as a multiplier', () => {
    expect(formatRatio(null)).toBe('—')
    expect(formatRatio(1.234)).toBe('×1.2')
    expect(formatRatio(0.5)).toBe('×0.5')
    expect(formatRatio(12.4)).toBe('×12')
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

  it('names a model with its version', () => {
    expect(modelVersionLabel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelVersionLabel('claude-opus-5')).toBe('Opus 5')
    expect(modelVersionLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(modelVersionLabel('google-gemini-3.1-flash-lite')).toBe('google-gemini-3.1-flash-lite')
  })

  it('names launch reasons and sessions outside the chain', () => {
    expect(launchLabel('checkpoint')).toBe('контрольная точка')
    expect(launchLabel(null)).toBe('вне цепочки')
  })
})

describe('weeklyLimit', () => {
  const month = { from: '2026-09-04', to: '2026-10-03' }
  const always = { from: '2026-01-01', to: '2026-10-03' }

  it('sums a week or less and averages longer periods per week', () => {
    expect(weeklyLimit(63, { from: '2026-09-27', to: '2026-10-03' }, always)).toEqual({ share: 63, perWeek: false, from: null, to: null })
    expect(weeklyLimit(20, { from: '2026-10-03', to: '2026-10-03' }, always)).toEqual({ share: 20, perWeek: false, from: null, to: null })
    expect(weeklyLimit(180, month, always)).toEqual({ share: 42, perWeek: true, from: null, to: null })
  })

  it('counts only the days covered by snapshots', () => {
    expect(weeklyLimit(14, month, { from: '2026-10-03', to: '2026-10-03' })).toEqual({ share: 14, perWeek: false, from: '2026-10-03', to: null })
    expect(weeklyLimit(100, month, { from: '2026-09-24', to: '2026-10-03' })).toEqual({ share: 70, perWeek: true, from: '2026-09-24', to: null })
    expect(weeklyLimit(10, month, { from: '2026-08-01', to: '2026-09-10' })).toEqual({ share: 10, perWeek: false, from: null, to: '2026-09-10' })
  })

  it('is zero when snapshots cover the period without any share', () => {
    expect(weeklyLimit(null, month, always)).toEqual({ share: 0, perWeek: true, from: null, to: null })
  })

  it('has no data without snapshots in the period', () => {
    const none = { share: null, perWeek: false, from: null, to: null }
    expect(weeklyLimit(null, month, null)).toEqual(none)
    expect(weeklyLimit(null, month, { from: '2026-10-04', to: '2026-10-05' })).toEqual(none)
    expect(weeklyLimit(null, month, { from: '2026-08-01', to: '2026-09-03' })).toEqual(none)
  })
})

describe('limitWindows', () => {
  const window = (account: string, peak: number, open = false) => ({ account, resetsAt: '2026-10-10T13:00:00.000Z', peak, open })

  it('lists the peaks of one account', () => {
    expect(limitWindows([window('global', 100), window('global', 97.4), window('global', 22, true)])).toBe('окна: 100 %, 97 %, 22 % идёт')
  })

  it('names the accounts when there are several', () => {
    expect(limitWindows([window('global', 100), window('john.doe', 73, true)])).toBe('окна: global 100 % · john.doe 73 % идёт')
  })

  it('is empty without windows', () => {
    expect(limitWindows([])).toBeNull()
  })
})
