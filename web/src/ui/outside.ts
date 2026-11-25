import { milestoneComparator } from '../../../src/chain/order.js'
import type { OutsideReason, OutsideTask } from '../../../src/state.js'
import type { StatusCategory, Task, TaskMilestone, TaskStatus } from '../../../src/tracker/model.js'
import { isClosedLamp, type BlockLamp } from '../state.js'
import { milestonePage } from './chainPage.js'

/** The groups of the "Outside the chain" view in their order (BTN-1428), the order a task with several reasons is filed by. */
export const OUTSIDE_REASONS: readonly OutsideReason[] = ['label', 'milestone', 'status']

/** Open by default: a milestone the rules leave out is mostly old milestones' leftovers, maybe hundreds of them. */
const OPEN_BY_DEFAULT: readonly OutsideReason[] = ['label', 'status']

/** The tasks of one status under a milestone (BTN-1673). */
export interface OutsideStatus {
  status: TaskStatus
  /** The tasks the page shows, in the view's order. */
  tasks: OutsideTask[]
}

export interface OutsideSection {
  milestone: TaskMilestone | null
  /** The milestone's statuses, the furthest along first. */
  statuses: OutsideStatus[]
}

export interface OutsideGroup {
  reason: OutsideReason
  count: number
  /** The milestones in the chain's order, no milestone last. */
  milestones: OutsideSection[]
}

/** The statuses of the usual workflow in the view's order; others go by their category after these of it. */
const KNOWN_STATUSES = ['in review', 'in progress', 'todo', 'backlog']
const CATEGORY_RANK: Record<StatusCategory, number> = { Active: 0, ToDo: 1, UnStarted: 2, Won: 3, Lost: 4 }

/** The furthest along first: In Review, In Progress, Todo, Backlog; an unknown status by its category, then by name. */
export function compareStatuses(a: TaskStatus, b: TaskStatus): number {
  const known = (status: TaskStatus) => {
    const index = KNOWN_STATUSES.indexOf(status.name.trim().toLocaleLowerCase())
    return index === -1 ? KNOWN_STATUSES.length : index
  }
  return CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category] || known(a) - known(b) || a.name.localeCompare(b.name, 'en')
}

/**
 * The groups of the view, the tasks the chain or the backlog already shows (`shown`) left out; an empty group is none.
 * Under each milestone the tasks go by status (`compareStatuses`), each status's tasks by `compare`, the view's order (BTN-1673).
 */
export function outsideGroups(tasks: readonly OutsideTask[], shown: ReadonlySet<string>, compare: (a: Task, b: Task) => number): OutsideGroup[] {
  const left = tasks.filter((each) => !shown.has(each.task.id))
  return OUTSIDE_REASONS.flatMap((reason) => {
    const own = left.filter((each) => each.reason === reason)
    if (own.length === 0) return []
    const named = new Map<string, TaskMilestone>()
    for (const each of own) if (each.task.milestone !== null && !named.has(each.task.milestone.label)) named.set(each.task.milestone.label, each.task.milestone)
    const ranked = [...named.values()]
    ranked.sort(milestoneComparator(ranked))
    const milestones: OutsideSection[] = [...ranked, null].flatMap((milestone) => {
      const under = own.filter((each) => (each.task.milestone?.label ?? null) === (milestone?.label ?? null))
      return under.length === 0 ? [] : [{ milestone, statuses: byStatus(under, compare) }]
    })
    return [{ reason, count: own.length, milestones }]
  })
}

function byStatus(tasks: readonly OutsideTask[], compare: (a: Task, b: Task) => number): OutsideStatus[] {
  const statuses = new Map<string, OutsideStatus>()
  for (const each of tasks) {
    const name = each.task.status.name.trim().toLocaleLowerCase()
    const section = statuses.get(name) ?? { status: each.task.status, tasks: [] }
    section.tasks.push(each)
    statuses.set(name, section)
  }
  const list = [...statuses.values()].sort((a, b) => compareStatuses(a.status, b.status))
  for (const section of list) section.tasks.sort((a, b) => compare(a.task, b.task))
  return list
}

export interface OutsidePage {
  /** The milestones with rows on the page; `count` — all of the milestone's tasks, and of each status. */
  sections: { milestone: TaskMilestone | null; count: number; statuses: (OutsideStatus & { count: number })[] }[]
  /** How many rows are behind the button. */
  hidden: number
  /** How many rows the next press adds. */
  next: number
}

/** A group cut as a long milestone of the chain is (`milestonePage`), across its milestones and statuses: the rest goes on under the same headings. */
export function outsidePage(group: OutsideGroup, more: number): OutsidePage {
  const rows = group.milestones.flatMap((section) => section.statuses.flatMap((status) => status.tasks.map((each) => ({ id: each.task.id, each }))))
  const page = milestonePage(rows, more, { keeps: () => false })
  const kept = new Set(page.head.map((row) => row.id))
  const sections = group.milestones.flatMap((section) => {
    const statuses = section.statuses.flatMap((status) => {
      const tasks = status.tasks.filter((each) => kept.has(each.task.id))
      return tasks.length === 0 ? [] : [{ status: status.status, tasks, count: status.tasks.length }]
    })
    const count = section.statuses.reduce((sum, status) => sum + status.tasks.length, 0)
    return statuses.length === 0 ? [] : [{ milestone: section.milestone, count, statuses }]
  })
  return { sections, hidden: page.hidden, next: page.next }
}

/**
 * The chain's tasks that hold a task of the view (BTN-1714): the open ones among its `blockedBy`, in the chain's order. A
 * closed blocker is not shown; a locked row is no chain task but a blocker outside it.
 */
export function chainHolders<B extends { id: string; lamp: BlockLamp; locked: boolean }>(blockedBy: readonly string[], chain: readonly B[]): B[] {
  if (blockedBy.length === 0) return []
  const wanted = new Set(blockedBy)
  return chain.filter((block) => wanted.has(block.id) && !block.locked && !isClosedLamp(block.lamp))
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
