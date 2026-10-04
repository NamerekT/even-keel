import { describe, expect, it } from 'vitest'
import type { StatsHistory } from '../../../src/stats/model.js'
import { OTHER, chartData, dayCosts, firstDay, heatLevel, projectColors, projectTotals } from './history.js'

const history: StatsHistory = {
  at: '2026-10-03T12:00:00.000Z',
  accounts: ['global'],
  tracked: ['CBL', 'BTN'],
  projects: ['BTN', 'yaml', 'CBL', 'notes', 'scratch'],
  days: ['2026-09-28', '2026-09-30', '2026-10-03'],
  cells: [
    [0, 0, 10, 2, 5],
    [0, 1, 4, 1, 1],
    [1, 2, 6, 1, 2],
    [1, 3, 1, 1, 0],
    [2, 0, 3, 1, 1],
    [2, 4, 0.5, 1, 0],
    [2, 1, 0, 1, 0],
  ],
  limits: { from: '2026-09-28', to: '2026-10-03' },
}

const range = { from: '2026-09-29', to: '2026-10-03' }

describe('projectTotals', () => {
  it('sums the range per project, the most expensive first, spendless ones left out', () => {
    expect(projectTotals(history, range)).toEqual([
      { project: 'CBL', cost: 6 },
      { project: 'BTN', cost: 3 },
      { project: 'notes', cost: 1 },
      { project: 'scratch', cost: 0.5 },
    ])
  })
})

describe('projectColors', () => {
  it('gives Even Keel projects their chart slots and the rest free slots by rank', () => {
    const colors = projectColors(history)
    expect(colors.get('CBL')).toBe(1)
    expect(colors.get('BTN')).toBe(2)
    expect(colors.get('yaml')).toBe(3)
    expect(colors.get('notes')).toBe(4)
  })

  it('runs out of slots after eight', () => {
    const many = { ...history, tracked: [],projects: Array.from({ length: 10 }, (_, index) => `p${index}`) }
    const colors = projectColors(many)
    expect(colors.get('p7')).toBe(8)
    expect(colors.get('p8')).toBeNull()
  })
})

describe('dayCosts', () => {
  it('sums the chosen projects per day', () => {
    expect(dayCosts(history, null)).toEqual(new Map([['2026-09-28', 14], ['2026-09-30', 7], ['2026-10-03', 3.5]]))
    expect(dayCosts(history, ['BTN'])).toEqual(new Map([['2026-09-28', 10], ['2026-10-03', 3]]))
  })
})

describe('heatLevel', () => {
  it('splits spend into four steps, none for an empty day', () => {
    expect(heatLevel(0, 10)).toBe(0)
    expect(heatLevel(0.1, 10)).toBe(1)
    expect(heatLevel(5, 10)).toBe(3)
    expect(heatLevel(10, 10)).toBe(4)
  })
})

describe('firstDay', () => {
  it('is the first day with data', () => {
    expect(firstDay(history)).toBe('2026-09-28')
    expect(firstDay({ ...history, days: [], cells: [] })).toBeNull()
  })
})

describe('chartData', () => {
  it('stacks the chosen projects by bucket, the most expensive at the bottom', () => {
    const chart = chartData(history, { from: '2026-09-28', to: '2026-10-03' }, 'week', 'cost', ['BTN', 'CBL'], 6)
    expect(chart.series.map((each) => each.key)).toEqual(['BTN', 'CBL'])
    expect(chart.buckets).toEqual([
      { bucket: '2026-09-28', values: [13, 6], total: 19 },
    ])
  })

  it('folds projects past the limit into others', () => {
    const chart = chartData(history, { from: '2026-09-28', to: '2026-10-03' }, 'day', 'cost', null, 2)
    expect(chart.series.map((each) => each.key)).toEqual(['BTN', 'CBL', OTHER])
    expect(chart.series[2]!.slot).toBeNull()
    expect(chart.buckets.map((each) => each.values)).toEqual([
      [10, 0, 4],
      [0, 0, 0],
      [0, 6, 1],
      [0, 0, 0],
      [0, 0, 0],
      [3, 0, 0.5],
    ])
  })

  it('counts limit shares and sessions as well', () => {
    const limit = chartData(history, { from: '2026-10-03', to: '2026-10-03' }, 'day', 'limit', ['BTN'], 6)
    expect(limit.buckets[0]!.total).toBe(1)
    const sessions = chartData(history, { from: '2026-10-03', to: '2026-10-03' }, 'day', 'sessions', null, 6)
    expect(sessions.buckets[0]!.total).toBe(3)
  })
})
