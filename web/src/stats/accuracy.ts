import type { StatsTaskRow } from '../../../src/stats/model.js'

const SPREAD = 1.5

export interface AccuracyGroup {
  key: string | null
  tasks: number
  within: number
  ratio: number
}

export interface Accuracy {
  done: number
  open: number
  medianS: number | null
  compared: number
  unestimated: number
  within: number | null
  ratio: number | null
  groups: Record<'project' | 'component' | 'model', AccuracyGroup[]>
}

interface Compared {
  row: StatsTaskRow
  ratio: number
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

const withinShare = (list: Compared[]) => (list.filter((each) => each.ratio >= 1 / SPREAD && each.ratio <= SPREAD).length / list.length) * 100

function groupBy(list: Compared[], key: (row: StatsTaskRow) => string | null): AccuracyGroup[] {
  const groups = new Map<string | null, Compared[]>()
  for (const each of list) groups.set(key(each.row), [...(groups.get(key(each.row)) ?? []), each])
  return [...groups]
    .map(([group, members]) => ({ key: group, tasks: members.length, within: withinShare(members), ratio: median(members.map((each) => each.ratio))! }))
    .sort((a, b) => b.tasks - a.tasks || (a.key === null ? 1 : b.key === null ? -1 : a.key.localeCompare(b.key)))
}

// Closed tasks only: an open task's time is not its fact yet.
export function accuracy(tasks: StatsTaskRow[]): Accuracy {
  const timed = tasks.filter((row) => row.activeS !== null)
  const done = timed.filter((row) => row.done === true)
  const compared = done.filter((row) => row.estimateH !== null && row.estimateH > 0).map((row) => ({ row, ratio: row.activeS! / 3600 / row.estimateH! }))
  return {
    done: done.length,
    open: timed.length - done.length,
    medianS: median(done.map((row) => row.activeS!)),
    compared: compared.length,
    unestimated: done.length - compared.length,
    within: compared.length === 0 ? null : withinShare(compared),
    ratio: median(compared.map((each) => each.ratio)),
    groups: {
      project: groupBy(compared, (row) => row.project),
      component: groupBy(compared, (row) => row.component),
      model: groupBy(compared, (row) => row.model),
    },
  }
}
