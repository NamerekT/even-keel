import { describe, expect, it } from 'vitest'
import { DEFAULT_RULES, type ChainRules } from './rules.js'
import type { Task } from '../tracker/model.js'
import type { ClosedPage, PageRequest, Tracker } from '../tracker/source.js'
import { archivePage, type ArchivePagesDeps } from './archive-pages.js'

const closed = (id: string, milestone: string | null = 'v1', subtasks = 0): Task => ({
  id,
  title: id,
  status: { name: 'Done', category: 'Won' },
  blockedBy: [],
  parent: null,
  subtasks,
  milestone: milestone === null ? null : { label: milestone, targetDate: null },
  priority: 'none',
  labels: [],
  estimate: null,
  question: false,
})

/** A tracker paging `tasks` by offset, `size` at most a page; `asked` records each request. */
function paged(tasks: Task[], asked: PageRequest[], size = Infinity) {
  return {
    run: async <T>(call: (tracker: Tracker) => Promise<T>) =>
      call({
        closedPage: async (_project: string, _rules: ChainRules, page: PageRequest): Promise<ClosedPage<Task>> => {
          asked.push(page)
          const from = page.after === null ? 0 : Number(page.after)
          const to = from + Math.min(page.limit, size)
          return { total: tasks.length - from, tasks: tasks.slice(from, to), next: to < tasks.length ? String(to) : null }
        },
      } as unknown as Tracker),
  }
}

function deps(links: Record<string, ReturnType<typeof paged> | undefined>, shown: string[] = [], rules: ChainRules = DEFAULT_RULES): ArchivePagesDeps {
  return { readers: () => Object.keys(links), linkOf: (reader) => links[reader], rulesOf: () => rules, shown: () => new Set(shown) }
}

describe('archivePage', () => {
  it('gives a page past the state\'s tasks, asking for a page plus those, then the next reader\'s (BTN-1445)', async () => {
    const asked: PageRequest[] = []
    const own = Array.from({ length: 20 }, (_, index) => closed(`APP-${20 - index}`))
    const feed = [closed('FED-2'), closed('FED-1')]
    const all = deps({ APP: paged(own, asked), FED: paged(feed, asked) }, ['APP-20', 'APP-19'])
    const first = await archivePage(all, 'APP', null)
    expect(asked[0]).toEqual({ after: null, limit: 18 })
    expect(first.tasks.map((task) => task.id)).toEqual(own.slice(2, 18).map((task) => task.id))
    const second = await archivePage(all, 'APP', first.next)
    expect(second.tasks.map((task) => task.id)).toEqual(['APP-2', 'APP-1'])
    const third = await archivePage(all, 'APP', second.next)
    expect(third).toEqual({ tasks: feed, next: null })
  })

  it('leaves out parents and the milestones the rules leave out, and asks again when nothing is left, four times at most', async () => {
    const asked: PageRequest[] = []
    const tasks = [closed('APP-9', 'v1', 2), closed('APP-8', 'old'), ...Array.from({ length: 7 }, (_, index) => closed(`APP-${7 - index}`))]
    const rules = { ...DEFAULT_RULES, excludedMilestones: ['old'] }
    const page = await archivePage(deps({ APP: paged(tasks, asked, 2) }, [], rules), 'APP', null)
    expect(page.tasks.map((task) => task.id)).toEqual(['APP-7', 'APP-6'])
    const shownAll = await archivePage(deps({ APP: paged(tasks, asked, 1) }, tasks.map((task) => task.id)), 'APP', null)
    expect(shownAll.tasks).toEqual([])
    expect(shownAll.next).not.toBeNull()
    expect(asked.length).toBe(2 + 4)
  })

  it('pages on until the task a link opens is among them, and skips a reader without pages', async () => {
    const tasks = Array.from({ length: 60 }, (_, index) => closed(`APP-${60 - index}`))
    const page = await archivePage(deps({ OFF: undefined, APP: paged(tasks, [], 16) }), 'APP', null, 'APP-3')
    expect(page.tasks.at(-1)?.id).toBe('APP-1')
    expect(page.tasks.some((task) => task.id === 'APP-3')).toBe(true)
    expect(page.next).toBeNull()
  })

  it('reads a cursor it did not give as the end', async () => {
    expect(await archivePage(deps({ APP: paged([closed('APP-1')], []) }), 'APP', 'nonsense')).toEqual({ tasks: [], next: null })
  })
})
