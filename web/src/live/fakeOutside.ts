import type { ArchivePage, EvenKeelState, OutsideReason, OutsideTask } from '../../../src/state.js'
import type { Task, TaskPriority, TaskStatus } from '../../../src/tracker/model.js'

/** How long the fake read takes, so the view's loader shows. */
const READ_MS = 600
/** The fake archive's page, small enough that "older" shows. */
const ARCHIVE_PAGE = 10

const BACKLOG: TaskStatus = { name: 'Backlog', category: 'UnStarted' }
const TODO: TaskStatus = { name: 'Todo', category: 'ToDo' }
const IN_PROGRESS: TaskStatus = { name: 'In Progress', category: 'Active' }
const IN_REVIEW: TaskStatus = { name: 'In Review', category: 'Active' }
const BLOCKED: TaskStatus = { name: 'Blocked', category: 'Active' }
const DONE: TaskStatus = { name: 'Done', category: 'Won' }
const CANCELED: TaskStatus = { name: 'Canceled', category: 'Lost' }

function fakeTask(id: string, title: string, status: TaskStatus, milestone: string | null, labels: string[], priority: TaskPriority = 'none'): Task {
  return {
    id,
    title,
    status,
    blockedBy: [],
    parent: null,
    subtasks: 0,
    milestone: milestone === null ? null : { label: milestone, targetDate: null },
    priority,
    labels,
    estimate: null,
    question: false,
  }
}

const prefixOf = (state: EvenKeelState, body: Record<string, unknown>) => (state.taskPrefixes[String(body.project)] ?? 'APP').toUpperCase()

/**
 * What the service's `outside/tasks` answers on `dev:fake` (BTN-1428), by `?outside=`: by default seven tasks with an
 * excluding label (two labels) over two milestones in four statuses, 31 in old milestones the rules leave out and two in
 * a status they count as closed; `many` — 140 in the old milestones, for the group's "Show more"; `none` — nothing, the
 * archive too; `error` — the read fails.
 */
export async function fakeOutside(state: EvenKeelState, body: Record<string, unknown>, mode: string | null): Promise<OutsideTask[]> {
  await new Promise((resolve) => setTimeout(resolve, READ_MS))
  if (mode === 'error') throw new Error('fake: the tracker does not answer')
  if (mode === 'none') return []
  const prefix = prefixOf(state, body)
  let number = 900
  const task = (reason: OutsideReason, title: string, status: TaskStatus, milestone: string | null, label?: string, priority?: TaskPriority): OutsideTask => ({
    task: fakeTask(`${prefix}-${number++}`, title, status, milestone, label === undefined ? [] : [label], priority),
    reason,
    ...(label !== undefined && { label }),
  })
  const second = 'Hand'
  const old = mode === 'many' ? 140 : 31
  // Chain tasks that hold tasks of the view (BTN-1714): the chain's first one holds two of them, the next two hold one.
  const order = state.chain.projects[String(body.project)]?.order ?? []
  const held = (each: OutsideTask, ...by: (string | undefined)[]): OutsideTask => ({ ...each, task: { ...each.task, blockedBy: by.filter((id) => id !== undefined) } })
  return [
    task('label', 'Check the Linear import live on the bench', IN_REVIEW, 'v0.3', 'Manual', 'high'),
    task('label', 'Move the bench to the server: Docker, VPN, backup', IN_PROGRESS, 'v0.3', second),
    held(task('label', 'Backup encryption: pick the key and where it lives', TODO, 'v0.4', second, 'urgent'), order[1], order[2]),
    held(task('label', 'Dark theme on the phone: check it live', TODO, 'v0.4', 'Manual'), order[0]),
    task('label', 'Record the site video: the chain on the phone', BACKLOG, 'v0.4', second, 'low'),
    held(task('label', 'Write the release post', BACKLOG, 'v0.4', 'Manual'), order[0]),
    task('label', 'Ask the hosting about a second disk', BACKLOG, null, second),
    ...Array.from({ length: old }, (_, index) => task('milestone', `Leftover of an old milestone ${index + 1}`, BACKLOG, index % 3 === 0 ? 'v0.0' : 'v0.1')),
    task('status', 'Review: the pull request waits for a second reviewer', BLOCKED, 'v0.4'),
    task('status', 'A task stuck in Blocked after the move', BLOCKED, 'v0.4'),
  ]
}

/**
 * What `outside/archive` answers on `dev:fake` (BTN-1673): 14 closed tasks the rules kept out, the last closed first, in
 * pages of ten, so the unfolded archive shows "older"; none with `?outside=none`, a failed read with `error`.
 */
export async function fakeOutsideArchive(state: EvenKeelState, body: Record<string, unknown>, mode: string | null): Promise<ArchivePage> {
  await new Promise((resolve) => setTimeout(resolve, READ_MS))
  if (mode === 'error') throw new Error('fake: the tracker does not answer')
  if (mode === 'none') return { tasks: [], next: null }
  const prefix = prefixOf(state, body)
  const all = Array.from({ length: 14 }, (_, index) =>
    fakeTask(
      `${prefix}-${880 - index}`,
      ['Check the badge on the phone', 'Try the release on a clean machine', 'Old milestone cleanup', 'Measure the cache on the bench'][index % 4]!,
      index % 5 === 3 ? CANCELED : DONE,
      index < 6 ? 'v0.3' : index < 10 ? 'v0.0' : null,
      index % 2 === 0 ? ['Manual'] : [],
    ),
  )
  const from = typeof body.after === 'string' ? Number(body.after) : 0
  const to = from + ARCHIVE_PAGE
  return { tasks: all.slice(from, to), next: to < all.length ? String(to) : null }
}
