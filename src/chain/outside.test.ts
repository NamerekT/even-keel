import { describe, expect, it } from 'vitest'
import type { Task, TaskStatus } from '../tracker/model.js'
import type { ChainTasks, ClosedPage, PageRequest, Tracker } from '../tracker/source.js'
import { outsideArchivePage, outsideTasks, type OutsideDeps } from './outside.js'
import { DEFAULT_RULES, outsideReason, type ChainRules } from './rules.js'

const TODO: TaskStatus = { name: 'Todo', category: 'ToDo' }
const BLOCKED: TaskStatus = { name: 'Blocked', category: 'Active' }
const DONE: TaskStatus = { name: 'Done', category: 'Won' }
const CANCELED: TaskStatus = { name: 'Canceled', category: 'Lost' }

const task = (id: string, fields: Partial<Task> = {}): Task => ({
  id,
  title: id,
  status: TODO,
  blockedBy: [],
  parent: null,
  subtasks: 0,
  milestone: null,
  priority: 'none',
  labels: [],
  estimate: null,
  question: false,
  ...fields,
})
const inMilestone = (label: string) => ({ milestone: { label, targetDate: null } })

describe('outsideReason', () => {
  const rules: ChainRules = { ...DEFAULT_RULES, terminal: ['Done', 'Blocked'], excludedLabels: ['Manual', 'Вручную'], requiredMilestones: ['v2'] }

  it('names the excluding label as the task spells it', () => {
    expect(outsideReason(rules, task('A-1', { labels: ['bug', 'manual'], ...inMilestone('v2') }))).toEqual({ reason: 'label', label: 'manual' })
  })

  it('files a task with several reasons under the first of label, milestone, status', () => {
    expect(outsideReason(rules, task('A-1', { labels: ['Manual'], status: BLOCKED, ...inMilestone('v1') }))?.reason).toBe('label')
    expect(outsideReason(rules, task('A-2', { status: BLOCKED, ...inMilestone('v1') }))?.reason).toBe('milestone')
    expect(outsideReason(rules, task('A-3', { status: BLOCKED, ...inMilestone('v2') }))?.reason).toBe('status')
  })

  it('leaves a task the chain or the backlog takes, and a task without a milestone where one is required is out by it', () => {
    expect(outsideReason(rules, task('A-1', inMilestone('v2')))).toBeNull()
    expect(outsideReason({ ...rules, requiredLabels: ['ready'] }, task('A-2', inMilestone('v2')))).toBeNull()
    expect(outsideReason(rules, task('A-3'))?.reason).toBe('milestone')
  })
})

describe('outsideTasks', () => {
  /** A tracker whose `chainTasks` gives what `open` lets in, the rules it was asked with recorded. */
  const tracker = (tasks: Task[], asked: ChainRules[]) => ({
    run: async <T>(call: (tracker: Tracker) => Promise<T>) =>
      call({
        chainTasks: async (_project: string, rules: ChainRules): Promise<ChainTasks> => {
          asked.push(rules)
          return { tasks, parents: [], closedParents: [], unknownStatuses: [] }
        },
      } as unknown as Tracker),
  })

  it('reads every reader by status categories and keeps the open tasks the rules leave out', async () => {
    const asked: ChainRules[] = []
    const rules: ChainRules = { ...DEFAULT_RULES, active: ['Todo'], terminal: ['Done', 'Blocked'], excludedLabels: ['Manual'] }
    const deps: OutsideDeps = {
      readers: () => ['A', 'AGH'],
      linkOf: (reader) =>
        tracker(
          reader === 'A'
            ? [task('A-1'), task('A-2', { labels: ['Manual'] }), task('A-3', { status: BLOCKED }), task('A-4', { status: DONE }), task('A-5', { status: CANCELED, labels: ['Manual'] })]
            : [task('AGH-1', { labels: ['Manual'] })],
          asked,
        ),
      rulesOf: (reader) => (reader === 'A' ? rules : { ...DEFAULT_RULES }),
      milestoneOrder: () => [],
    }
    const found = await outsideTasks(deps, 'A')
    expect(found.map((each) => [each.task.id, each.reason])).toEqual([
      ['A-2', 'label'],
      ['A-3', 'status'],
    ])
    expect(asked[0]).toMatchObject({ active: null, terminal: null, excludedLabels: ['Manual'] })
    expect(asked).toHaveLength(2)
  })

  it('ranks the milestones by the project saved order', async () => {
    const deps: OutsideDeps = {
      readers: () => ['A'],
      linkOf: () => tracker([task('A-1', inMilestone('v1')), task('A-2', inMilestone('v2'))], []),
      rulesOf: () => ({ ...DEFAULT_RULES, excludedMilestones: ['v1', 'v2'] }),
      milestoneOrder: () => ['v2', 'v1'],
    }
    const found = await outsideTasks(deps, 'A')
    expect(found.map((each) => [each.task.id, each.task.milestone?.trackerOrder?.value])).toEqual([
      ['A-1', 1],
      ['A-2', 0],
    ])
  })

  it('skips a reader without a link', async () => {
    const deps: OutsideDeps = { readers: () => ['A'], linkOf: () => undefined, rulesOf: () => DEFAULT_RULES, milestoneOrder: () => [] }
    expect(await outsideTasks(deps, 'A')).toEqual([])
  })
})

describe('outsideArchivePage', () => {
  /** A tracker paging `tasks` by offset, `size` at most a page, the rules and requests it was asked with recorded. */
  const paged = (tasks: Task[], asked: { rules: ChainRules; page: PageRequest }[], size = Infinity) => ({
    run: async <T>(call: (tracker: Tracker) => Promise<T>) =>
      call({
        closedPage: async (_project: string, rules: ChainRules, page: PageRequest): Promise<ClosedPage<Task>> => {
          asked.push({ rules, page })
          const from = page.after === null ? 0 : Number(page.after)
          const to = from + Math.min(page.limit, size)
          return { total: tasks.length - from, tasks: tasks.slice(from, to), next: to < tasks.length ? String(to) : null }
        },
      } as unknown as Tracker),
  })
  const rules: ChainRules = { ...DEFAULT_RULES, terminal: ['Done'], excludedLabels: ['Manual'], excludedMilestones: ['old'] }

  it('keeps the closed tasks an excluding label or a left-out milestone kept out, last closed first, by status categories (BTN-1673)', async () => {
    const asked: { rules: ChainRules; page: PageRequest }[] = []
    const tasks = [
      task('A-9', { status: DONE, labels: ['manual'] }),
      task('A-8', { status: DONE }),
      task('A-7', { status: CANCELED, ...inMilestone('old') }),
      task('A-6', { status: DONE, labels: ['Manual'], subtasks: 2 }),
      task('A-5', { status: CANCELED, labels: ['Manual'], ...inMilestone('v1') }),
    ]
    const page = await outsideArchivePage({ readers: () => ['A'], linkOf: () => paged(tasks, asked), rulesOf: () => rules }, 'A', null)
    expect(page.tasks.map((each) => each.id)).toEqual(['A-9', 'A-7', 'A-5'])
    expect(page.next).toBeNull()
    expect(asked[0]!.rules).toMatchObject({ active: null, terminal: null, excludedLabels: ['Manual'] })
  })

  it('asks again while a page has none of them and gives the cursor on, then the next reader', async () => {
    const asked: { rules: ChainRules; page: PageRequest }[] = []
    const own = [...Array.from({ length: 6 }, (_, index) => task(`A-${20 - index}`, { status: DONE })), task('A-1', { status: DONE, labels: ['Manual'] })]
    const links: Record<string, ReturnType<typeof paged>> = { A: paged(own, asked, 1), F: paged([task('F-1', { status: DONE, labels: ['Manual'] })], asked) }
    const deps = { readers: () => ['A', 'F'], linkOf: (reader: string) => links[reader], rulesOf: () => rules }
    const first = await outsideArchivePage(deps, 'A', null)
    expect(first.tasks).toEqual([])
    expect(first.next).not.toBeNull()
    let next = first.next
    const found: string[] = []
    while (next !== null) {
      const page = await outsideArchivePage(deps, 'A', next)
      found.push(...page.tasks.map((each) => each.id))
      next = page.next
    }
    expect(found).toEqual(['A-1', 'F-1'])
  })
})
