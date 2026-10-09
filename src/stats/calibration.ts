// Estimate calibration for one project (BTN-82): what past closed tasks estimated at each step of the
// doubling scale actually took, and recent closed tasks of the same component. The huly plugin's hook shows
// it to the agent at the moment it sets an estimate.

export const STEPS = [5, 10, 20, 40, 80] as const
export type Step = (typeof STEPS)[number]

const RECENT = 8

export interface CalibrationRow {
  task: string
  title: string | null
  component: string | null
  estimateH: number | null
  activeMin: number
}

export interface CalibrationStep {
  minutes: Step
  closed: number
  median: number | null
  low: number | null
  high: number | null
  thin: boolean
}

export interface CalibrationTask {
  task: string
  title: string | null
  component: string | null
  estimateMin: number | null
  activeMin: number
}

export interface Calibration {
  project: string
  component: string | null
  closed: number
  estimated: number
  thin: boolean
  steps: CalibrationStep[]
  scope: 'component' | 'project'
  recent: CalibrationTask[]
}

/** The step an estimate in Huly's hours stands for, within a minute; estimates of the old scale have none. */
export function stepOf(hours: number | null): Step | null {
  if (hours === null) return null
  return STEPS.find((step) => Math.abs(hours * 60 - step) <= 1) ?? null
}

// Linear interpolation between the closest ranks, as percentile_cont does.
function quantile(sorted: number[], share: number): number {
  const at = (sorted.length - 1) * share
  const below = Math.floor(at)
  const above = Math.ceil(at)
  return sorted[below]! + (sorted[above]! - sorted[below]!) * (at - below)
}

/** `rows` are the closed tasks of the project, most recently worked first. */
export function mapCalibration(project: string, component: string | null, rows: CalibrationRow[], minTasks: number): Calibration {
  const steps = STEPS.map((minutes): CalibrationStep => {
    const actual = rows
      .filter((row) => stepOf(row.estimateH) === minutes)
      .map((row) => row.activeMin)
      .sort((a, b) => a - b)
    const closed = actual.length
    const thin = closed < minTasks
    if (closed === 0) return { minutes, closed, median: null, low: null, high: null, thin }
    return { minutes, closed, median: quantile(actual, 0.5), low: quantile(actual, 0.25), high: quantile(actual, 0.75), thin }
  })
  const estimated = steps.reduce((sum, step) => sum + step.closed, 0)
  const own = component === null ? [] : rows.filter((row) => row.component === component)
  const scope = own.length > 0 ? 'component' : 'project'
  const recent = (scope === 'component' ? own : rows).slice(0, RECENT).map((row) => ({
    task: row.task,
    title: row.title,
    component: row.component,
    estimateMin: row.estimateH === null ? null : (stepOf(row.estimateH) ?? Math.round(row.estimateH * 60)),
    activeMin: row.activeMin,
  }))
  return { project, component, closed: rows.length, estimated, thin: estimated < minTasks, steps, scope, recent }
}
