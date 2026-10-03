import type { PeriodQuery } from './model.js'

// Upper bounds of the run-length buckets in seconds; the last bucket is open.
export const STEP_BUCKETS = [3, 10, 30, 60, 120, 300, 600]

export interface StepSettings {
  slowSeconds: number
  growth: { ratio: number; minRuns: number; minSeconds: number }
}

export const DEFAULT_STEP_SETTINGS: StepSettings = { slowSeconds: 60, growth: { ratio: 1.5, minRuns: 5, minSeconds: 10 } }

export interface StepRunRow {
  step: string
  task: string | null
  week: string
  startedAt: number
  endedAt: number
  seconds: number
  cold: boolean
  outcome: string | null
  current: boolean
}

export interface StepSpread {
  n: number
  p50: number | null
  p90: number | null
}

export interface StatsStepWeek {
  week: string
  n: number
  p50: number
  p90: number
  grewP50: boolean
  grewP90: boolean
}

export interface StatsStepGrowth {
  week: string
  quantile: 'p50' | 'p90'
  from: number
  to: number
}

export type StepOutcomes = Record<'ok' | 'fail' | 'timeout' | 'killed' | 'unknown', number>

export interface StatsStep {
  step: string
  n: number
  p50: number
  p90: number
  max: number
  total: number
  slow: number
  buckets: number[]
  cold: StepSpread
  warm: StepSpread
  outcomes: StepOutcomes
  share: number | null
  weeks: StatsStepWeek[]
  growth: StatsStepGrowth[]
}

export interface StatsUnknownStep {
  signature: string
  n: number
  seconds: number
  max: number
  command: string
}

export interface StatsSteps {
  query: PeriodQuery
  at: string
  settings: StepSettings
  tasks: number
  steps: StatsStep[]
  unknown: StatsUnknownStep[]
}

export interface StatsTaskStep {
  step: string
  runs: number
  seconds: number
  share: number | null
}

export interface Interval {
  from: number
  to: number
}

export interface TaskTime {
  base: number
  steps: Map<string, { runs: number; seconds: number }>
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  const at = (sorted.length - 1) * q
  const low = Math.floor(at)
  const high = Math.ceil(at)
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (at - low)
}

export function bucketsOf(seconds: number[]): number[] {
  const counts = new Array<number>(STEP_BUCKETS.length + 1).fill(0)
  for (const value of seconds) {
    const index = STEP_BUCKETS.findIndex((bound) => value < bound)
    counts[index === -1 ? STEP_BUCKETS.length : index]! += 1
  }
  return counts
}

export function union(intervals: Interval[]): Interval[] {
  const merged: Interval[] = []
  for (const each of [...intervals].filter((item) => item.to > item.from).sort((a, b) => a.from - b.from)) {
    const last = merged.at(-1)
    if (last !== undefined && each.from <= last.to) last.to = Math.max(last.to, each.to)
    else merged.push({ ...each })
  }
  return merged
}

export function measure(intervals: Interval[]): number {
  return union(intervals).reduce((sum, each) => sum + (each.to - each.from), 0) / 1000
}

export function minus(from: Interval[], cut: Interval[]): Interval[] {
  const holes = union(cut)
  const left: Interval[] = []
  for (const each of union(from)) {
    let start = each.from
    for (const hole of holes) {
      if (hole.to <= start || hole.from >= each.to) continue
      if (hole.from > start) left.push({ from: start, to: hole.from })
      start = Math.max(start, hole.to)
    }
    if (start < each.to) left.push({ from: start, to: each.to })
  }
  return left
}

// Time a task spent on its steps: a step's runs merged, against the active time of the task plus the
// time its runs went on while no turn was open (a background check the session slept through).
export function taskTime(runs: { step: string; startedAt: number; endedAt: number }[], turns: Interval[], activeS: number): TaskTime {
  const spans = runs.map((run) => ({ from: run.startedAt, to: run.endedAt }))
  const base = activeS + measure(minus(spans, turns))
  const steps = new Map<string, { runs: number; seconds: number }>()
  for (const name of new Set(runs.map((run) => run.step))) {
    const own = runs.filter((run) => run.step === name)
    steps.set(name, { runs: own.length, seconds: measure(own.map((run) => ({ from: run.startedAt, to: run.endedAt }))) })
  }
  return { base, steps }
}

export function taskSteps(time: TaskTime): StatsTaskStep[] {
  return [...time.steps]
    .map(([step, { runs, seconds }]) => ({ step, runs, seconds, share: time.base > 0 ? Math.min(1, seconds / time.base) : null }))
    .sort((a, b) => b.seconds - a.seconds || a.step.localeCompare(b.step))
}

export function shareOf(times: TaskTime[]): Map<string, number> {
  const base = times.reduce((sum, time) => sum + time.base, 0)
  const shares = new Map<string, number>()
  if (base <= 0) return shares
  for (const time of times) for (const [step, { seconds }] of time.steps) shares.set(step, (shares.get(step) ?? 0) + seconds)
  for (const [step, seconds] of shares) shares.set(step, Math.min(1, seconds / base))
  return shares
}

function spread(seconds: number[]): StepSpread {
  const sorted = [...seconds].sort((a, b) => a - b)
  return { n: sorted.length, p50: sorted.length > 0 ? quantile(sorted, 0.5) : null, p90: sorted.length > 0 ? quantile(sorted, 0.9) : null }
}

// The same rule as the step_growth view of Tally: against the previous week with runs.
export function weeksOf(runs: StepRunRow[], growth: StepSettings['growth']): StatsStepWeek[] {
  const byWeek = new Map<string, number[]>()
  for (const run of runs) byWeek.set(run.week, [...(byWeek.get(run.week) ?? []), run.seconds])
  const weeks: StatsStepWeek[] = []
  for (const week of [...byWeek.keys()].sort()) {
    const sorted = byWeek.get(week)!.sort((a, b) => a - b)
    const p50 = quantile(sorted, 0.5)
    const p90 = quantile(sorted, 0.9)
    const prev = weeks.at(-1)
    const enough = prev !== undefined && sorted.length >= growth.minRuns && prev.n >= growth.minRuns
    const grew = (now: number, before: number) => enough && now >= before * growth.ratio && now - before >= growth.minSeconds
    weeks.push({ week, n: sorted.length, p50, p90, grewP50: grew(p50, prev?.p50 ?? 0), grewP90: grew(p90, prev?.p90 ?? 0) })
  }
  return weeks
}

export function growthOf(weeks: StatsStepWeek[], current: Set<string>): StatsStepGrowth[] {
  const found: StatsStepGrowth[] = []
  weeks.forEach((week, index) => {
    if (!current.has(week.week) || index === 0) return
    const prev = weeks[index - 1]!
    if (week.grewP90) found.push({ week: week.week, quantile: 'p90', from: prev.p90, to: week.p90 })
    else if (week.grewP50) found.push({ week: week.week, quantile: 'p50', from: prev.p50, to: week.p50 })
  })
  return found.reverse()
}

export function stepsOf(runs: StepRunRow[], settings: StepSettings, shares: Map<string, number>): StatsStep[] {
  const names = [...new Set(runs.filter((run) => run.current).map((run) => run.step))]
  return names
    .map((step) => {
      const all = runs.filter((run) => run.step === step)
      const cur = all.filter((run) => run.current)
      const seconds = cur.map((run) => run.seconds).sort((a, b) => a - b)
      const outcomes: StepOutcomes = { ok: 0, fail: 0, timeout: 0, killed: 0, unknown: 0 }
      for (const run of cur) {
        const key = run.outcome !== null && run.outcome in outcomes ? (run.outcome as keyof StepOutcomes) : 'unknown'
        outcomes[key] += 1
      }
      const weeks = weeksOf(all, settings.growth)
      return {
        step,
        n: seconds.length,
        p50: quantile(seconds, 0.5),
        p90: quantile(seconds, 0.9),
        max: seconds.at(-1)!,
        total: seconds.reduce((sum, value) => sum + value, 0),
        slow: seconds.filter((value) => value > settings.slowSeconds).length / seconds.length,
        buckets: bucketsOf(seconds),
        cold: spread(cur.filter((run) => run.cold).map((run) => run.seconds)),
        warm: spread(cur.filter((run) => !run.cold).map((run) => run.seconds)),
        outcomes,
        share: shares.get(step) ?? null,
        weeks,
        growth: growthOf(weeks, new Set(cur.map((run) => run.week))),
      }
    })
    .sort((a, b) => b.total - a.total || a.step.localeCompare(b.step))
}

export function parseStepSettings(value: unknown): StepSettings {
  const read = (raw: unknown, fallback: number) => (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : fallback)
  const given = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const growth = (typeof given.growth === 'object' && given.growth !== null ? given.growth : {}) as Record<string, unknown>
  const defaults = DEFAULT_STEP_SETTINGS
  return {
    slowSeconds: read(given.slowSeconds, defaults.slowSeconds),
    growth: {
      ratio: read(growth.ratio, defaults.growth.ratio),
      minRuns: read(growth.minRuns, defaults.growth.minRuns),
      minSeconds: read(growth.minSeconds, defaults.growth.minSeconds),
    },
  }
}
