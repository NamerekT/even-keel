import type { EvenKeelState, OutsideReason, OutsideTask } from '../../../src/state.js'
import type { TaskStatus } from '../../../src/tracker/model.js'

/** How long the fake read takes, so the view's loader shows. */
const READ_MS = 600

const BACKLOG: TaskStatus = { name: 'Backlog', category: 'UnStarted' }
const TODO: TaskStatus = { name: 'Todo', category: 'ToDo' }
const BLOCKED: TaskStatus = { name: 'Blocked', category: 'Active' }

/**
 * What the service's `outside/tasks` answers on `dev:fake` (BTN-1428), by `?outside=`: by default five tasks with an
 * excluding label (two labels) over two milestones, 31 in old milestones the rules leave out and two in a status they
 * count as closed; `many` — 140 in the old milestones, for the group's "Show more"; `one` — the label group with one label
 * only; `none` — nothing; `error` — the read fails.
 */
export async function fakeOutside(state: EvenKeelState, body: Record<string, unknown>, mode: string | null): Promise<OutsideTask[]> {
  await new Promise((resolve) => setTimeout(resolve, READ_MS))
  if (mode === 'error') throw new Error('fake: the tracker does not answer')
  if (mode === 'none') return []
  const project = String(body.project)
  const prefix = (state.taskPrefixes[project] ?? 'APP').toUpperCase()
  let number = 900
  const task = (reason: OutsideReason, title: string, status: TaskStatus, milestone: string | null, label?: string): OutsideTask => ({
    task: {
      id: `${prefix}-${number++}`,
      title,
      status,
      blockedBy: [],
      parent: null,
      subtasks: 0,
      milestone: milestone === null ? null : { label: milestone, targetDate: null },
      priority: 'none',
      labels: label === undefined ? [] : [label],
      estimate: null,
      question: false,
    },
    reason,
    ...(label !== undefined && { label }),
  })
  const second = mode === 'one' ? 'Manual' : 'Hand'
  const old = mode === 'many' ? 140 : 31
  return [
    task('label', 'Check the Linear import live on the bench', BACKLOG, 'v0.3', 'Manual'),
    task('label', 'Move the bench to the server: Docker, VPN, backup', BACKLOG, 'v0.3', second),
    task('label', 'Backup encryption: pick the key and where it lives', BACKLOG, 'v0.4', second),
    task('label', 'Dark theme on the phone: check it live', TODO, 'v0.4', 'Manual'),
    task('label', 'Record the site video: the chain on the phone', BACKLOG, null, second),
    ...Array.from({ length: old }, (_, index) => task('milestone', `Leftover of an old milestone ${index + 1}`, BACKLOG, index % 3 === 0 ? 'v0.0' : 'v0.1')),
    task('status', 'Review: the pull request waits for a second reviewer', BLOCKED, 'v0.4'),
    task('status', 'A task stuck in Blocked after the move', BLOCKED, 'v0.4'),
  ]
}
