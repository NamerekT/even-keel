import { fail } from '../../../src/notice/notice.js'
import type { EvenKeelState, ProjectTask } from '../../../src/state.js'
import { isOpen } from '../../../src/tracker/model.js'

/**
 * The built-in tracker's components and estimates in the fake (BTN-1288): kept here until the page reloads, since the
 * fake's tasks carry neither. `?components=empty` — a project with none yet.
 */
interface FakeComponent {
  id: string
  project: string
  name: string
  description: string
  createdAt: string
}

const SEED: [string, string][] = [
  ['Server', 'Сервис, маршруты, база состояния'],
  ['UI', 'Страница: карточки, окна, телефон'],
  ['Tracker', 'Адаптеры трекеров и встроенный трекер'],
  ['Sessions', 'Запуск сессий, транскрипты, модели'],
  ['Stats', ''],
  ['Billing', ''],
]

const components: FakeComponent[] = []
const seeded = new Set<string>()
/** A task's component id, set once the project is seeded. */
const held = new Map<string, string | null>()
const estimates = new Map<string, number | null>()
let made = 0

// Read at the start: the page drops the fake's parameters from its address afterwards.
const EMPTY = typeof location !== 'undefined' && new URLSearchParams(location.search).get('components') === 'empty'
const empty = () => EMPTY
const same = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()

function seed(state: EvenKeelState, project: string): FakeComponent[] {
  if (!seeded.has(project)) {
    seeded.add(project)
    if (!empty()) {
      for (const [name, description] of SEED) components.push({ id: `c${(made += 1)}`, project, name, description, createdAt: '2026-10-02T09:00:00Z' })
      const mine = components.filter((each) => each.project === project)
      const tasks = state.tasks.filter((each) => each.project === project)
      // Open tasks go round the first four, closed ones to Stats: Billing stays new and empty.
      tasks.forEach((task, at) => held.set(task.id, isOpen(task.status) ? (mine[at % 4]?.id ?? null) : (mine[4]?.id ?? null)))
    }
  }
  return components.filter((each) => each.project === project)
}

const projectOfTask = (state: EvenKeelState, task: string) => state.tasks.find((each) => each.id === task)?.project ?? task.split('-')[0]!

/** The card's component and the project's component names. */
export function fakeCardComponent(state: EvenKeelState, task: string): { component: string | null; components: string[] } {
  const list = seed(state, projectOfTask(state, task))
  const id = held.get(task) ?? null
  return { component: list.find((each) => each.id === id)?.name ?? null, components: list.map((each) => each.name).sort(byName) }
}

/** The card's estimate as changed on it; `undefined` — not changed. */
export const fakeEstimate = (task: string): number | null | undefined => estimates.get(task)

const byName = (a: string, b: string) => a.toLocaleLowerCase().localeCompare(b.toLocaleLowerCase())

function counts(state: EvenKeelState, component: FakeComponent): { open: number; total: number } {
  const tasks: ProjectTask[] = state.tasks.filter((each) => held.get(each.id) === component.id)
  return { open: tasks.filter((each) => isOpen(each.status)).length, total: tasks.length }
}

/** A components or estimate query; `null` — not one of them. */
export function fakeComponentQuery(state: EvenKeelState, name: string, body: Record<string, unknown>): { result: unknown } | null {
  const project = String(body.project ?? '')
  switch (name) {
    case 'builtin/components':
      return { result: seed(state, project).sort((a, b) => byName(a.name, b.name)).map((each) => ({ ...each, ...counts(state, each) })) }
    case 'builtin/component': {
      const list = seed(state, project)
      const id = typeof body.id === 'string' ? body.id : null
      const typed = String(body.name ?? '').trim()
      if (typed === '') throw fail('builtin.emptyName', {})
      if (list.some((each) => each.id !== id && same(each.name, typed))) throw fail('builtin.componentTaken', { name: typed })
      const description = String(body.description ?? '')
      const found = list.find((each) => each.id === id)
      if (found !== undefined) Object.assign(found, { name: typed, description })
      else components.push({ id: `c${(made += 1)}`, project, name: typed, description, createdAt: new Date().toISOString() })
      return { result: { id: found?.id ?? `c${made}` } }
    }
    case 'builtin/component/delete': {
      const id = String(body.id)
      const to = typeof body.to === 'string' ? body.to : null
      for (const [task, component] of held) if (component === id) held.set(task, to)
      components.splice(components.findIndex((each) => each.id === id), 1)
      return { result: {} }
    }
    case 'builtin/estimate':
      estimates.set(String(body.task), body.minutes as number | null)
      return { result: {} }
    default:
      return null
  }
}

/** The card's component edit; a new name makes the component, as the service does. */
export function fakeComponentEdit(state: EvenKeelState, task: string, to: string | null): void {
  const project = projectOfTask(state, task)
  const list = seed(state, project)
  if (to === null) return void held.set(task, null)
  let found = list.find((each) => same(each.name, to))
  if (found === undefined) {
    found = { id: `c${(made += 1)}`, project, name: to.trim(), description: '', createdAt: new Date().toISOString() }
    components.push(found)
  }
  held.set(task, found.id)
}
