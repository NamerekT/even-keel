// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArchivePage, OutsideTask } from '../../../src/state.js'
import type { Task, TaskStatus } from '../../../src/tracker/model.js'
import { MemoryRouter } from 'react-router'
import { t } from '../i18n/index.js'
import type { ChainBlock } from '../state.js'
import { OutsideView } from './OutsideView.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const live = vi.hoisted(() => ({
  tasks: [] as OutsideTask[],
  archive: { tasks: [], next: null } as ArchivePage,
  /** The tracker's reads of the project, as the live state carries them. */
  readAt: null as number | null,
  /** `outside/tasks` fails after this many milliseconds; `null` — it answers at once. */
  failAfter: null as number | null,
  /** The chain's order and its waiting blockers in the live state. */
  order: [] as string[],
  waiting: [] as string[],
}))
vi.mock('../live/context.js', () => ({
  useLive: () => ({
    state: {
      chain: { projects: { p1: { order: live.order, waiting: live.waiting, backlog: [] } } },
      trackers: live.readAt === null ? [] : [{ projects: ['p1'], readAt: { p1: live.readAt } }],
    },
    read: async (name: string) => {
      if (name !== 'outside/tasks') return live.archive
      const after = live.failAfter
      if (after === null) return live.tasks
      return new Promise((_, reject) => setTimeout(() => reject(new Error('no answer')), after))
    },
  }),
}))

const status = (name: string, category: TaskStatus['category']): TaskStatus => ({ name, category })
const TODO = status('Todo', 'ToDo')
const REVIEW = status('In Review', 'Active')
const DONE = status('Done', 'Won')
const task = (id: string, at: TaskStatus): Task => ({
  id,
  title: `Title of ${id}`,
  status: at,
  blockedBy: [],
  parent: null,
  subtasks: 0,
  milestone: { label: 'v0.4', targetDate: null },
  priority: 'none',
  labels: ['Manual'],
  estimate: null,
  question: false,
})
const out = (id: string, at: TaskStatus): OutsideTask => ({ task: task(id, at), reason: 'label', label: 'Manual' })

let root: Root
let host: HTMLElement
const saved = new Map<string, string>()

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  saved.clear()
  saved.set('even-keel.outside.open.p1', 'label')
  saved.set('even-keel.outside.archive.p1', '1')
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.useRealTimers()
  live.tasks = []
  live.archive = { tasks: [], next: null }
  live.readAt = null
  live.failAfter = null
  live.order = []
  live.waiting = []
  chain = []
})

let chain: ChainBlock[] = []
const render = (edits: number) =>
  act(async () =>
    root.render(
      createElement(MemoryRouter, { initialEntries: ['/p/p1?view=outside'] }, createElement(OutsideView, { project: 'p1', switcher: null, chain, edits, onCard: () => {} })),
    ),
  )
/** The first read: the rows come once the loader has gone through its entrance and exit. */
const open = async () => {
  await render(0)
  for (let step = 0; step < 5; step += 1) await act(async () => vi.advanceTimersByTimeAsync(200))
}

/** Each status section's name and its rows' keys, top to bottom. */
const sections = () =>
  [...host.querySelectorAll('.outside__status')].map((section) => [
    section.querySelector('.outside__status-name')?.textContent,
    [...section.querySelectorAll('.block')].map((row) => row.getAttribute('data-block')),
  ])
const archived = () => [...host.querySelectorAll('.archived')].map((row) => row.getAttribute('data-block'))

describe('OutsideView', () => {
  it('moves a row to its new status section after a card edit, without a reload', async () => {
    live.tasks = [out('A-1', TODO), out('A-2', TODO)]
    await open()
    expect(sections()).toEqual([['Todo', ['A-2', 'A-1']]])

    live.tasks = [out('A-1', REVIEW), out('A-2', TODO)]
    await render(1)
    expect(sections()).toEqual([
      ['In Review', ['A-1']],
      ['Todo', ['A-2']],
    ])
  })

  it('moves a closed row out to the Archive after a card edit', async () => {
    live.tasks = [out('A-1', TODO), out('A-2', TODO)]
    await open()
    expect(archived()).toEqual([])

    live.tasks = [out('A-2', TODO)]
    live.archive = { tasks: [task('A-1', DONE)], next: null }
    await render(1)
    expect(sections()).toEqual([['Todo', ['A-2']]])
    expect(archived()).toEqual(['A-1'])
  })

  it('shows the failed read when a tracker read came while the first read was still out', async () => {
    live.failAfter = 600
    await render(0)
    live.readAt = 1
    await render(0)
    for (let step = 0; step < 10; step += 1) await act(async () => vi.advanceTimersByTimeAsync(200))
    expect(host.querySelector('.outside__failed')).not.toBeNull()
  })

  it('keeps the rows when a later read fails', async () => {
    live.tasks = [out('A-1', TODO)]
    await open()
    live.failAfter = 0
    await render(1)
    await act(async () => vi.advanceTimersByTimeAsync(10))
    expect(sections()).toEqual([['Todo', ['A-1']]])
    expect(host.querySelector('.outside__failed')).toBeNull()
  })

  it('puts the open chain tasks that block a task before it, with their status, out of the counts', async () => {
    const blocker = (id: string, lamp: ChainBlock['lamp'], status: string, stage: ChainBlock['stage']) =>
      ({ id, title: `Title of ${id}`, status, stage, lamp, locked: false, current: false, blockedBy: [] as string[] }) as ChainBlock
    chain = [blocker('C-1', 'working', 'In Progress', 'Active'), blocker('C-2', 'ahead', 'Todo', 'ToDo'), blocker('C-3', 'done', 'Done', 'Won')]
    const held = (id: string, by: string[]): OutsideTask => ({ ...out(id, TODO), task: { ...task(id, TODO), blockedBy: by } })
    live.tasks = [held('A-1', ['C-1', 'C-3']), held('A-2', ['C-2', 'C-1'])]
    await open()
    expect(sections()).toEqual([['Todo', ['C-1', 'C-2', 'A-2', 'C-1', 'A-1']]])
    expect(host.querySelector('.outside__status-count')?.textContent).toBe('2')
    const first = host.querySelector('.outside__holder')!
    expect(first.querySelector('.outside__holder-status')?.textContent).toBe('In Progress')
    expect(first.querySelector('a.block__key')?.getAttribute('href')).toBe('/p/p1#C-1')
    expect(host.querySelector('.bracket')).not.toBeNull()
  })

  it("shows the chain's waiting blockers with a lock that names the chain tasks they hold (BTN-1768)", async () => {
    const block = (id: string, locked: boolean, blockedBy: string[]) =>
      ({ id, title: `Title of ${id}`, status: 'Todo', stage: 'ToDo', lamp: 'ahead', locked, current: false, blockedBy }) as ChainBlock
    chain = [block('W-1', true, []), block('C-1', false, ['W-1']), block('C-2', false, [])]
    live.order = ['C-1', 'C-2']
    live.waiting = ['W-1']
    live.tasks = [out('W-1', TODO), out('A-1', TODO), out('C-2', TODO)]
    await open()
    expect(sections()).toEqual([['Todo', ['W-1', 'A-1']]])
    const marks = [...host.querySelectorAll('.outside__holds')]
    expect(marks.map((mark) => mark.closest('.block')?.getAttribute('data-block'))).toEqual(['W-1'])
    expect(marks[0]!.textContent).toContain(t.chain.outside.holds(['C-1']))
  })

  it('shows the order switch only over rows', async () => {
    await open()
    expect(host.querySelector('.order-switch')).toBeNull()
    live.tasks = [out('A-1', TODO)]
    await render(1)
    expect(host.querySelector('.order-switch')).not.toBeNull()
  })
})
