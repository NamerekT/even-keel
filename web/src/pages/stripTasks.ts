import type { StatsTaskRow } from '../../../src/stats/model.js'
import { median } from '../stats/accuracy.js'

const TOP = 3

export interface StripTasks {
  /** The costliest tasks of the period, the costliest first. */
  top: StatsTaskRow[]
  /** The middle finished task of the period: its cost and active time, each the median on its own. */
  median: { cost: number; activeS: number | null; count: number } | null
}

/** What the project strip tells about its tasks over the period, from the rows `/stats` lists for it. */
export function stripTasks(rows: StatsTaskRow[]): StripTasks {
  const top = rows
    .filter((row) => row.cost > 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, TOP)
  const done = rows.filter((row) => row.done === true)
  const cost = median(done.map((row) => row.cost))
  return {
    top,
    median:
      cost === null ? null : { cost, activeS: median(done.flatMap((row) => (row.activeS === null ? [] : [row.activeS]))), count: done.length },
  }
}
