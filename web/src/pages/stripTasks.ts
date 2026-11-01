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

/** The last strip tasks of each project (by its id), with the query they answered. */
export type StripMemory = Map<string, { key: string; tasks: StripTasks }>

/**
 * The strip's tasks for `key`, the project's current query: a fresh answer counts only when it answered that query,
 * since the page keeps the hook between projects; until it comes, the project's remembered answer of the same query.
 */
export function keptTasks(memory: StripMemory, project: string, key: string, fresh: { key: string; tasks: StripTasks } | null): StripTasks | null {
  if (fresh !== null && fresh.key === key) {
    memory.set(project, fresh)
    return fresh.tasks
  }
  const kept = memory.get(project)
  return kept !== undefined && kept.key === key ? kept.tasks : null
}
