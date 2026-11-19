import { fail } from '../../../src/notice/notice.js'
import type { EvenKeelState, ProjectTask } from '../../../src/state.js'
import { isOpen } from '../../../src/tracker/model.js'
import type { MilestoneRow, MilestoneStatus } from '../pages/MilestoneDialogs.js'

/**
 * The built-in tracker's milestones in the fake (BTN-1287): those the project's tasks carry, ABC's empty new one and two
 * closed ones with no task of the fake behind them. Kept here until the page reloads; a rename or a deletion moves the
 * fake's tasks.
 */
interface FakeMilestone {
  id: string
  project: string
  name: string
  date: number | null
  description: string
  status: MilestoneStatus
  closedAt: string | null
  createdAt: string
  /** The closed ones' own counts: the fake has no task in them. */
  closedTasks?: number
}

/** ABC's milestone made a moment ago with no task yet, so the chain shows it as an empty group with its ghost. */
export const EMPTY_MILESTONE = 'v0.4 — выпуск'

const milestones: FakeMilestone[] = []
const seeded = new Set<string>()
let made = 0
const same = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()
const tasksOf = (state: EvenKeelState, project: string) => state.tasks.filter((each) => each.project === project)

function seed(state: EvenKeelState, project: string): FakeMilestone[] {
  if (!seeded.has(project)) {
    seeded.add(project)
    const carried = new Set(tasksOf(state, project).flatMap((task) => (task.milestone === null ? [] : [task.milestone.label])))
    const add = (each: Omit<FakeMilestone, 'id' | 'project'>) => milestones.push({ id: `m${(made += 1)}`, project, ...each })
    // The fake's tasks carry a target of 0: the first milestone is under way, the next ones planned, the last one undated.
    const targets = [Date.UTC(2026, 10, 30), Date.UTC(2026, 11, 20)]
    ;[...carried].forEach((name, at) =>
      add({ name, date: targets[at] ?? null, description: '', status: at === 0 ? 'active' : 'planned', closedAt: null, createdAt: '2026-10-01T09:00:00Z' }),
    )
    if (project === 'ABC') add({ name: EMPTY_MILESTONE, date: null, description: '', status: 'planned', closedAt: null, createdAt: '2026-11-18T12:00:00Z' })
    add({ name: 'v0.1', date: Date.UTC(2026, 8, 30), description: 'Первый выпуск.', status: 'completed', closedAt: '2026-10-02T15:30:00Z', createdAt: '2026-09-01T09:00:00Z', closedTasks: 14 })
    add({ name: 'Импорт задач из внешнего трекера по расписанию, каждую ночь', date: null, description: '', status: 'canceled', closedAt: '2026-10-20T10:00:00Z', createdAt: '2026-09-20T09:00:00Z', closedTasks: 0 })
  }
  return milestones.filter((each) => each.project === project)
}

function rowOf(state: EvenKeelState, milestone: FakeMilestone): MilestoneRow {
  const tasks = tasksOf(state, milestone.project).filter((each) => each.milestone !== null && same(each.milestone.label, milestone.name))
  const open = tasks.filter((each) => isOpen(each.status))
  const { closedTasks, project: _, ...row } = milestone
  return { ...row, open: open.length, total: closedTasks ?? tasks.length, openTasks: open.map((each) => each.id) }
}

/** The project's tasks of `from` moved to `to` (`null` — none), with its target date. */
function relabel(state: EvenKeelState, project: string, from: string, to: FakeMilestone | null): EvenKeelState {
  const moved = (task: ProjectTask): ProjectTask =>
    task.project !== project || task.milestone === null || !same(task.milestone.label, from)
      ? task
      : { ...task, milestone: to === null ? null : { label: to.name, targetDate: to.date } }
  return { ...state, tasks: state.tasks.map(moved) }
}

const isClosed = (status: MilestoneStatus) => status === 'completed' || status === 'canceled'

/** A milestones query; `null` — not one of them. */
export function fakeMilestoneQuery(state: EvenKeelState, name: string, body: Record<string, unknown>): { state: EvenKeelState; result: unknown } | null {
  const project = String(body.project ?? '')
  switch (name) {
    case 'builtin/milestones':
      return { state, result: seed(state, project).map((each) => rowOf(state, each)) }
    case 'builtin/milestone/save': {
      const list = seed(state, project)
      const id = typeof body.id === 'string' ? body.id : null
      const typed = String(body.name ?? '').trim()
      if (typed === '') throw fail('builtin.emptyName', {})
      if (list.some((each) => each.id !== id && same(each.name, typed))) throw fail('builtin.milestoneTaken', { name: typed })
      const status = body.status as MilestoneStatus
      const date = typeof body.date === 'number' ? body.date : null
      const description = String(body.description ?? '')
      const found = list.find((each) => each.id === id)
      if (found === undefined) {
        const fresh = { id: `m${(made += 1)}`, project, name: typed, date, description, status, closedAt: null, createdAt: new Date().toISOString() }
        milestones.push(fresh)
        return { state, result: { id: fresh.id } }
      }
      const from = found.name
      const closedAt = isClosed(status) ? (isClosed(found.status) ? found.closedAt : new Date().toISOString()) : null
      Object.assign(found, { name: typed, date, description, status, closedAt })
      return { state: relabel(state, project, from, found), result: { id: found.id } }
    }
    case 'builtin/milestone/delete': {
      const list = seed(state, project)
      const found = list.find((each) => each.id === String(body.id))
      if (found === undefined) return { state, result: {} }
      const closedTasks = rowOf(state, found).total - rowOf(state, found).open
      if (closedTasks > 0) throw fail('builtin.milestoneClosedTasks', { milestone: found.name, count: closedTasks })
      const to = typeof body.to === 'string' ? (list.find((each) => each.id === body.to) ?? null) : null
      milestones.splice(milestones.indexOf(found), 1)
      return { state: relabel(state, project, found.name, to), result: {} }
    }
    default:
      return null
  }
}
