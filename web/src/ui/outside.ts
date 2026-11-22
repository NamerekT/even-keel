import { milestoneComparator } from '../../../src/chain/order.js'
import type { OutsideReason, OutsideTask } from '../../../src/state.js'
import type { TaskMilestone } from '../../../src/tracker/model.js'
import { milestonePage } from './chainPage.js'

/** The groups of the "Outside the chain" view in their order (BTN-1428), the order a task with several reasons is filed by. */
export const OUTSIDE_REASONS: readonly OutsideReason[] = ['label', 'milestone', 'status']

/** Open by default: a milestone the rules leave out is mostly old milestones' leftovers, maybe hundreds of them. */
const OPEN_BY_DEFAULT: readonly OutsideReason[] = ['label', 'status']

export interface OutsideSection {
  milestone: TaskMilestone | null
  /** The section's tasks the page shows, by number. */
  tasks: OutsideTask[]
}

export interface OutsideGroup {
  reason: OutsideReason
  count: number
  /** The rows name their excluding label: the group has more than one, so its heading does not say which. */
  labels: boolean
  /** The milestones in the chain's order, no milestone last. */
  milestones: OutsideSection[]
}

const byNumber = (a: OutsideTask, b: OutsideTask) => a.task.id.localeCompare(b.task.id, 'en', { numeric: true })

/** The groups of the view, the tasks the chain or the backlog already shows (`shown`) left out; an empty group is none. */
export function outsideGroups(tasks: readonly OutsideTask[], shown: ReadonlySet<string>): OutsideGroup[] {
  const left = tasks.filter((each) => !shown.has(each.task.id))
  return OUTSIDE_REASONS.flatMap((reason) => {
    const own = left.filter((each) => each.reason === reason).sort(byNumber)
    if (own.length === 0) return []
    const named = new Map<string, TaskMilestone>()
    for (const each of own) if (each.task.milestone !== null && !named.has(each.task.milestone.label)) named.set(each.task.milestone.label, each.task.milestone)
    const ranked = [...named.values()]
    ranked.sort(milestoneComparator(ranked))
    const milestones: OutsideSection[] = [...ranked, null].flatMap((milestone) => {
      const under = own.filter((each) => (each.task.milestone?.label ?? null) === (milestone?.label ?? null))
      return under.length === 0 ? [] : [{ milestone, tasks: under }]
    })
    const labels = new Set(own.flatMap((each) => (each.label === undefined ? [] : [each.label.trim().toLocaleLowerCase()])))
    return [{ reason, count: own.length, labels: labels.size > 1, milestones }]
  })
}

export interface OutsidePage {
  /** The milestones with rows on the page; `count` — all of the milestone's tasks. */
  sections: (OutsideSection & { count: number })[]
  /** How many rows are behind the button. */
  hidden: number
  /** How many rows the next press adds. */
  next: number
}

/** A group cut as a long milestone of the chain is (`milestonePage`), across its milestones: the rest goes on under the same heading. */
export function outsidePage(group: OutsideGroup, more: number): OutsidePage {
  const rows = group.milestones.flatMap((section) => section.tasks.map((each) => ({ id: each.task.id, each })))
  const page = milestonePage(rows, more, { keeps: () => false })
  const kept = new Set(page.head.map((row) => row.id))
  const sections = group.milestones.flatMap((section) => {
    const tasks = section.tasks.filter((each) => kept.has(each.task.id))
    return tasks.length === 0 ? [] : [{ milestone: section.milestone, tasks, count: section.tasks.length }]
  })
  return { sections, hidden: page.hidden, next: page.next }
}

/** The groups open on this device, from their saved text; nothing saved — the default ones. */
export function parseOpen(text: string | null): OutsideReason[] {
  if (text === null) return [...OPEN_BY_DEFAULT]
  const saved = text.split(',')
  return OUTSIDE_REASONS.filter((reason) => saved.includes(reason))
}

export function openText(open: readonly OutsideReason[]): string {
  return open.join(',')
}
