import type { StatsPeriod } from '../stats/model.js'
import type { BadgeStats } from './model.js'

const DAY_MS = 86_400_000
/** The badge counts the project's last 30 days, like the strip of its page. */
export const BADGE_STATS_DAYS = 30

/** The last 30 local days of `tz` ending today, as `/stats` takes them. */
export function badgeStatsRange(now: Date, tz: string): { from: string; to: string } {
  const to = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - (BADGE_STATS_DAYS - 1) * DAY_MS).toISOString().slice(0, 10)
  return { from, to }
}

/**
 * The badge's numbers from the project's period: its sessions, and the median finished task — its cost at API list
 * prices and its active minutes, each the median on its own.
 */
export function badgeStatsOf(period: StatsPeriod): BadgeStats {
  const done = period.tasks.filter((row) => row.done === true)
  const result: BadgeStats = { sessions: period.current.sessions }
  const cost = median(done.map((row) => row.priceEstimate ?? row.cost))
  if (cost !== null) result.medianCost = Math.round(cost * 100) / 100
  const minutes = median(done.flatMap((row) => (row.activeS === null ? [] : [row.activeS / 60])))
  if (minutes !== null) result.medianMinutes = Math.round(minutes)
  return result
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}
