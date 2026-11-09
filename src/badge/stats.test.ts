import { describe, expect, it } from 'vitest'
import type { StatsPeriod, StatsTaskRow } from '../stats/model.js'
import { badgeStatsOf, badgeStatsRange } from './stats.js'

const row = (cost: number, priceEstimate: number | null, activeS: number | null, done: boolean | null) => ({ cost, priceEstimate, activeS, done }) as StatsTaskRow
const period = (tasks: StatsTaskRow[], sessions = 7) => ({ current: { sessions }, tasks }) as unknown as StatsPeriod

describe('badgeStatsOf', () => {
  it('takes the median finished task at API list prices and its active minutes, each on its own', () => {
    const stats = badgeStatsOf(period([row(0.5, 2, 600, true), row(1, null, null, true), row(3, null, 1800, true), row(99, null, 99_999, false)]))
    expect(stats).toEqual({ sessions: 7, medianCost: 2, medianMinutes: 20 })
  })

  it('has only the sessions without a finished task', () => {
    expect(badgeStatsOf(period([row(1, null, 60, null)], 0))).toEqual({ sessions: 0 })
  })
})

describe('badgeStatsRange', () => {
  it('is the last 30 local days ending today in the zone', () => {
    expect(badgeStatsRange(new Date('2026-11-09T23:30:00Z'), 'Europe/Berlin')).toEqual({ from: '2026-10-12', to: '2026-11-10' })
    expect(badgeStatsRange(new Date('2026-03-01T10:00:00Z'), 'UTC')).toEqual({ from: '2026-01-31', to: '2026-03-01' })
  })
})
