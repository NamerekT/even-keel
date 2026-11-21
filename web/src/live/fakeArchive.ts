import type { ArchivePage, EvenKeelState } from '../../../src/state.js'
import type { Task } from '../../../src/tracker/model.js'

/** How long a fake page of the archive takes, so the pressed button's spinner shows. */
const PAGE_MS = 700
const PAGE = 16

/** `?archive=many` (BTN-1445): the first project's trackers hold this many closed tasks beyond the state's. */
export function fakeArchiveCount(param: string | null): number {
  return param === 'many' ? 300 : param === 'few' ? 20 : 0
}

export function withFakeArchive(state: EvenKeelState, count: number): EvenKeelState {
  const project = state.projects[0]
  return project === undefined || count === 0 ? state : { ...state, archiveMore: { [project]: count } }
}

/** The fake trackers' older closed tasks of the project: numbers the state does not use, the newest first. */
function olderTasks(state: EvenKeelState, project: string, count: number): Task[] {
  const prefix = (state.taskPrefixes[project] ?? 'APP').toUpperCase()
  const used = new Set(state.tasks.map((task) => task.id))
  const tasks: Task[] = []
  for (let number = count * 2; number > 0 && tasks.length < count; number--) {
    const id = `${prefix}-${number}`
    if (used.has(id)) continue
    tasks.push({
      id,
      title: `Older closed task ${number}`,
      status: number % 7 === 0 ? { name: 'Canceled', category: 'Lost' } : { name: 'Done', category: 'Won' },
      blockedBy: [],
      parent: null,
      subtasks: 0,
      milestone: { label: number > count ? 'v0.2' : 'v0.1', targetDate: null },
      priority: 'none',
      labels: [],
      estimate: null,
      question: false,
    })
  }
  return tasks
}

/** What the service's `archive/page` answers on `dev:fake`: offsets as cursors, paged on to `focus`. */
export async function fakeArchivePage(state: EvenKeelState, body: Record<string, unknown>, count: number): Promise<ArchivePage> {
  await new Promise((resolve) => setTimeout(resolve, PAGE_MS))
  const project = String(body.project)
  if (project !== state.projects[0]) return { tasks: [], next: null }
  const all = olderTasks(state, project, count)
  const from = typeof body.after === 'string' ? Number(body.after) : 0
  const found = typeof body.focus === 'string' ? all.findIndex((task) => task.id === body.focus) : -1
  const to = Math.min(all.length, Math.max(from + PAGE, found + 1))
  return { tasks: all.slice(from, to), next: to < all.length ? String(to) : null }
}
