import type { StatsTaskRow } from '../../../src/stats/model.js'

const SPREAD = 1.5
const WIDE_SPREAD = 2

// The same shares had every compared task been estimated at the median time of its project's closed tasks.
export interface Baseline {
  within: number
  within2: number
}

export interface AccuracyGroup {
  key: string | null
  tasks: number
  within: number
  within2: number
  baseline: Baseline
  ratio: number
}

export interface Accuracy {
  done: number
  open: number
  medianS: number | null
  compared: number
  unestimated: number
  within: number | null
  within2: number | null
  baseline: Baseline | null
  ratio: number | null
  groups: Record<'project' | 'component' | 'model', AccuracyGroup[]>
}

interface Compared {
  row: StatsTaskRow
  ratio: number
  baseline: number
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

const share = (ratios: number[], spread: number) => (ratios.filter((ratio) => ratio >= 1 / spread && ratio <= spread).length / ratios.length) * 100

const shares = (list: Compared[]) => {
  const ratios = list.map((each) => each.ratio)
  const baselines = list.map((each) => each.baseline)
  return {
    within: share(ratios, SPREAD),
    within2: share(ratios, WIDE_SPREAD),
    baseline: { within: share(baselines, SPREAD), within2: share(baselines, WIDE_SPREAD) },
  }
}

function groupBy(list: Compared[], key: (row: StatsTaskRow) => string | null): AccuracyGroup[] {
  const groups = new Map<string | null, Compared[]>()
  for (const each of list) groups.set(key(each.row), [...(groups.get(key(each.row)) ?? []), each])
  return [...groups]
    .map(([group, members]) => ({ key: group, tasks: members.length, ...shares(members), ratio: median(members.map((each) => each.ratio))! }))
    .sort((a, b) => b.tasks - a.tasks || (a.key === null ? 1 : b.key === null ? -1 : a.key.localeCompare(b.key)))
}

function projectMedians(done: StatsTaskRow[]): Map<string, number> {
  const times = new Map<string, number[]>()
  for (const row of done) times.set(row.project, [...(times.get(row.project) ?? []), row.activeS!])
  return new Map([...times].map(([project, values]) => [project, median(values)!]))
}

// Closed tasks only: an open task's time is not its fact yet.
export function accuracy(tasks: StatsTaskRow[]): Accuracy {
  const timed = tasks.filter((row) => row.activeS !== null)
  const done = timed.filter((row) => row.done === true)
  const medians = projectMedians(done)
  const compared = done
    .filter((row) => row.estimateH !== null && row.estimateH > 0)
    .map((row) => ({ row, ratio: row.activeS! / 3600 / row.estimateH!, baseline: row.activeS! / medians.get(row.project)! }))
  const overall = compared.length === 0 ? null : shares(compared)
  return {
    done: done.length,
    open: timed.length - done.length,
    medianS: median(done.map((row) => row.activeS!)),
    compared: compared.length,
    unestimated: done.length - compared.length,
    within: overall?.within ?? null,
    within2: overall?.within2 ?? null,
    baseline: overall?.baseline ?? null,
    ratio: median(compared.map((each) => each.ratio)),
    groups: {
      project: groupBy(compared, (row) => row.project),
      component: groupBy(compared, (row) => row.component),
      model: groupBy(compared, (row) => row.model),
    },
  }
}
