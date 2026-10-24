import type { StatsHistory } from '../../../src/stats/model.js'
import { t } from '../i18n/index.js'
import { PROJECT_SLOTS } from '../state.js'
import { bucketOf, buckets as listBuckets, type DayRange, type Step } from './period.js'

export type Metric = 'cost' | 'limit' | 'sessions'

export const OTHER = '\u0000other'
export const SERIES_LIMIT = 6

export interface ProjectTotal {
  project: string
  cost: number
}

export interface ChartSeries {
  key: string
  label: string
  slot: number | null
}

export interface ChartBucket {
  bucket: string
  values: number[]
  total: number
}

export interface ChartData {
  series: ChartSeries[]
  buckets: ChartBucket[]
}

const METRIC_COLUMN: Record<Metric, 2 | 3 | 4> = { cost: 2, sessions: 3, limit: 4 }

function inRange(history: StatsHistory, range: DayRange): (day: number) => boolean {
  const days = history.days.map((day) => day >= range.from && day <= range.to)
  return (day) => days[day]!
}

export function firstDay(history: StatsHistory): string | null {
  return history.days[0] ?? null
}

export function projectTotals(history: StatsHistory, range: DayRange): ProjectTotal[] {
  const within = inRange(history, range)
  const totals = new Map<string, number>()
  for (const [day, project, cost] of history.cells) {
    if (!within(day) || cost <= 0) continue
    const name = history.projects[project]!
    totals.set(name, (totals.get(name) ?? 0) + cost)
  }
  return [...totals]
    .map(([project, cost]) => ({ project, cost }))
    .sort((a, b) => b.cost - a.cost || a.project.localeCompare(b.project))
}

/** Even Keel's projects keep their own slots by key (`keySlots`); the other folders of the stats take the free ones by rank. */
export function projectColors(history: StatsHistory, own: Record<string, number | null>): Map<string, number | null> {
  const colors = new Map(Object.entries(own))
  const taken = new Set(Object.values(own).filter((slot) => slot !== null))
  const free = Array.from({ length: PROJECT_SLOTS }, (_, index) => index + 1).filter((slot) => !taken.has(slot))
  for (const project of history.projects) {
    if (!colors.has(project)) colors.set(project, free.shift() ?? null)
  }
  return colors
}

export function dayCosts(history: StatsHistory, projects: string[] | null): Map<string, number> {
  const chosen = projects === null ? null : new Set(projects)
  const costs = new Map<string, number>()
  for (const [day, project, cost] of history.cells) {
    if (chosen !== null && !chosen.has(history.projects[project]!)) continue
    const name = history.days[day]!
    costs.set(name, (costs.get(name) ?? 0) + cost)
  }
  return costs
}

export function heatLevel(cost: number, max: number): number {
  if (cost <= 0 || max <= 0) return 0
  return Math.min(4, Math.max(1, Math.ceil(Math.sqrt(cost / max) * 4)))
}

export function chartData(
  history: StatsHistory,
  range: DayRange,
  step: Step,
  metric: Metric,
  projects: string[] | null,
  colors: Map<string, number | null>,
  limit = SERIES_LIMIT,
): ChartData {
  const within = inRange(history, range)
  const chosen = projects === null ? null : new Set(projects)
  const present = new Map<string, number>()
  for (const [day, project, cost] of history.cells) {
    const name = history.projects[project]!
    if (!within(day) || (chosen !== null && !chosen.has(name))) continue
    present.set(name, (present.get(name) ?? 0) + cost)
  }
  const ranked = [...present].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name)
  const own = ranked.slice(0, limit)
  const series: ChartSeries[] = own.map((key) => ({ key, label: key, slot: colors.get(key) ?? null }))
  if (ranked.length > own.length) series.push({ key: OTHER, label: t.stats.others, slot: null })
  const seriesIndex = new Map(own.map((key, index) => [key, index]))

  const keys = listBuckets(range, step)
  const bucketIndex = new Map(keys.map((key, index) => [key, index]))
  const rows = keys.map((bucket) => ({ bucket, values: series.map(() => 0), total: 0 }))
  const column = METRIC_COLUMN[metric]
  for (const cell of history.cells) {
    const name = history.projects[cell[1]]!
    if (!within(cell[0]) || !present.has(name)) continue
    const row = rows[bucketIndex.get(bucketOf(history.days[cell[0]]!, step))!]!
    const index = seriesIndex.get(name) ?? own.length
    row.values[index]! += cell[column]
    row.total += cell[column]
  }
  for (const row of rows) {
    row.values = row.values.map(tidy)
    row.total = tidy(row.total)
  }
  return { series, buckets: rows }
}

function tidy(value: number): number {
  return Number(value.toFixed(4))
}
