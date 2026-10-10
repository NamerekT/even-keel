import type { StatsShare, StatsTaskRow, StatsTotals, StatsWeekReason } from '../../../src/stats/model.js'
import type { Accuracy } from './accuracy.js'

/** The one verdict stamped over the summary tiles. */
export type Stamp =
  | { kind: 'calm' }
  | { kind: 'overspend'; times: number }
  | { kind: 'aground'; share: number }
  | { kind: 'bargain' }
  | { kind: 'evenKeel' }

const OVERSPEND = 2
const BARGAIN = 0.5
const AGROUND_SHARE = 25
const EVEN_KEEL = { tasks: 5, share: 5 }

export function stampOf(current: StatsTotals, previous: StatsTotals): Stamp | null {
  if (current.cost === 0) return { kind: 'calm' }
  const times = previous.cost > 0 ? current.cost / previous.cost : null
  if (times !== null && times >= OVERSPEND) return { kind: 'overspend', times: Math.round(times * 10) / 10 }
  const stuck = (current.stuckCost / current.cost) * 100
  if (stuck >= AGROUND_SHARE) return { kind: 'aground', share: Math.round(stuck) }
  if (times !== null && times <= BARGAIN) return { kind: 'bargain' }
  if (current.tasks >= EVEN_KEEL.tasks && stuck < EVEN_KEEL.share) return { kind: 'evenKeel' }
  return null
}

const MONO_SHARE = 0.9

export function sourcesRemark(models: StatsShare[]): { kind: 'mono'; model: string } | null {
  const total = models.reduce((sum, each) => sum + each.cost, 0)
  const top = models.reduce<StatsShare | null>((best, each) => (best === null || each.cost > best.cost ? each : best), null)
  return top !== null && total > 0 && top.cost >= total * MONO_SHARE ? { kind: 'mono', model: top.key } : null
}

export type EstimateRemark = { kind: 'baseline' } | { kind: 'sharp' } | { kind: 'optimist'; ratio: number } | { kind: 'pessimist'; ratio: number }

const JUDGED = 5
const SHARP = 70
const OPTIMIST = 1.5

export function estimateRemark(result: Accuracy): EstimateRemark | null {
  if (result.compared < JUDGED || result.within === null || result.ratio === null) return null
  if (result.baseline !== null && result.baseline.within > result.within) return { kind: 'baseline' }
  if (result.within >= SHARP) return { kind: 'sharp' }
  if (result.ratio >= OPTIMIST) return { kind: 'optimist', ratio: result.ratio }
  if (result.ratio <= 1 / OPTIMIST) return { kind: 'pessimist', ratio: result.ratio }
  return null
}

export type TasksRemark = { kind: 'whale'; task: string; share: number } | { kind: 'stubborn'; task: string; sessions: number }

const WHALE = { tasks: 3, share: 0.3 }
const STUBBORN = 5

export function tasksRemark(tasks: StatsTaskRow[]): TasksRemark | null {
  const total = tasks.reduce((sum, each) => sum + each.cost, 0)
  const priciest = tasks.reduce<StatsTaskRow | null>((best, each) => (best === null || each.cost > best.cost ? each : best), null)
  if (priciest === null) return null
  if (tasks.length >= WHALE.tasks && total > 0 && priciest.cost >= total * WHALE.share) {
    return { kind: 'whale', task: priciest.task, share: Math.round((priciest.cost / total) * 100) }
  }
  const longest = tasks.reduce((best, each) => (each.sessions > best.sessions ? each : best), priciest)
  return longest.sessions >= STUBBORN ? { kind: 'stubborn', task: longest.task, sessions: longest.sessions } : null
}

/** Stuck reasons that have a remark; `normal`, `other` and unsorted spans have none. */
export const STUCK_REASONS = ['unclear_task', 'broken_tooling', 'debug_loop', 'waiting_user', 'limit_env'] as const
export type StuckReason = (typeof STUCK_REASONS)[number]

const STUCK_SPANS = 3

export function stuckRemark(weeks: StatsWeekReason[]): { reason: StuckReason } | null {
  const counts = new Map<StuckReason, number>()
  for (const each of weeks) {
    const reason = STUCK_REASONS.find((known) => known === each.reason)
    if (reason !== undefined) counts.set(reason, (counts.get(reason) ?? 0) + each.spans)
  }
  const [top] = [...counts].sort((a, b) => b[1] - a[1])
  return top !== undefined && top[1] >= STUCK_SPANS ? { reason: top[0] } : null
}
