import { isOpen, type Task, type TaskMilestone } from '../tracker/model.js'
import { MANUAL_ORDER, milestoneComparator } from './order.js'

export interface SequencedMilestone {
  label: string
  /** Not in the saved order: placed by the automatic one until the user moves it. */
  fresh: boolean
}

/**
 * The project's milestones in the order its chain goes by (BTN-792), each label once. Without a saved order it is the
 * automatic one (BTN-791). With one, the saved labels no task carries drop out, and a milestone the order lacks goes
 * right after its closest predecessor in the automatic order that the saved one has, or first when none has.
 */
export function milestoneSequence(milestones: readonly TaskMilestone[], saved: readonly string[]): SequencedMilestone[] {
  const auto = [...milestones].sort(milestoneComparator(milestones)).map((each) => each.label).filter((label, index, all) => all.indexOf(label) === index)
  if (saved.length === 0) return auto.map((label) => ({ label, fresh: false }))
  const present = new Set(auto)
  const kept = saved.filter((label, index) => present.has(label) && saved.indexOf(label) === index)
  const keptSet = new Set(kept)
  const after = new Map<string | null, string[]>()
  let anchor: string | null = null
  for (const label of auto) {
    if (keptSet.has(label)) anchor = label
    else after.set(anchor, [...(after.get(anchor) ?? []), label])
  }
  const fresh = (from: string | null) => (after.get(from) ?? []).map((label) => ({ label, fresh: true }))
  return [...fresh(null), ...kept.flatMap((label) => [{ label, fresh: false }, ...fresh(label)])]
}

/**
 * The tasks with their milestones ranked by the project's saved order; the tasks as they are without one. The order is
 * of the open tasks' milestones, so a milestone left with closed tasks only drops out of it; such milestones go after
 * the rest in the automatic order.
 */
export function withMilestoneOrder<T extends Task>(tasks: T[], saved: readonly string[]): T[] {
  if (saved.length === 0) return tasks
  const of = (list: T[]) => list.flatMap((task) => (task.milestone === null ? [] : [task.milestone]))
  const live = milestoneSequence(of(tasks.filter((task) => isOpen(task.status))), saved)
  const known = new Set(live.map((each) => each.label))
  const closed = milestoneSequence(of(tasks).filter((each) => !known.has(each.label)), [])
  const rank = new Map([...live, ...closed].map((each, index) => [each.label, index]))
  return tasks.map((task) =>
    task.milestone === null ? task : { ...task, milestone: { ...task.milestone, trackerOrder: { source: MANUAL_ORDER, value: rank.get(task.milestone.label)! } } },
  )
}
