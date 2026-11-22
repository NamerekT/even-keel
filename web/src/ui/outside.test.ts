import { describe, expect, it } from 'vitest'
import type { OutsideTask } from '../../../src/state.js'
import type { Task, TaskMilestone } from '../../../src/tracker/model.js'
import { CHAIN_MORE, CHAIN_PAGE } from './chainPage.js'
import { outsideGroups, outsidePage, parseOpen, openText } from './outside.js'

const milestone = (label: string, targetDate: number | null = null): TaskMilestone => ({ label, targetDate })
const task = (id: string, at: TaskMilestone | null = null): Task => ({
  id,
  title: id,
  status: { name: 'Todo', category: 'ToDo' },
  blockedBy: [],
  parent: null,
  subtasks: 0,
  milestone: at,
  priority: 'none',
  labels: [],
  estimate: null,
  question: false,
})
const out = (id: string, reason: OutsideTask['reason'], at: TaskMilestone | null = null, label?: string): OutsideTask => ({
  task: task(id, at),
  reason,
  ...(label !== undefined && { label }),
})

describe('outsideGroups', () => {
  it('files the groups by reason in a fixed order, the milestones in the chain order, no milestone last, tasks by number', () => {
    const groups = outsideGroups(
      [
        out('A-10', 'status', milestone('v0.4')),
        out('A-2', 'label', milestone('v0.4'), 'Manual'),
        out('A-9', 'label', null, 'Manual'),
        out('A-1', 'label', milestone('v0.3'), 'Manual'),
        out('A-12', 'label', milestone('v0.3'), 'Manual'),
        out('A-5', 'milestone', milestone('v0.10')),
      ],
      new Set(),
    )
    expect(groups.map((group) => [group.reason, group.count])).toEqual([
      ['label', 4],
      ['milestone', 1],
      ['status', 1],
    ])
    expect(groups[0]!.milestones.map((each) => [each.milestone?.label ?? null, each.tasks.map((one) => one.task.id)])).toEqual([
      ['v0.3', ['A-1', 'A-12']],
      ['v0.4', ['A-2']],
      [null, ['A-9']],
    ])
  })

  it('leaves out what the chain or the backlog shows, and a group with nothing left', () => {
    const groups = outsideGroups([out('A-1', 'label', null, 'Manual'), out('A-2', 'status')], new Set(['A-2']))
    expect(groups.map((group) => group.reason)).toEqual(['label'])
  })

  it('names the label on the rows only where the group has several labels', () => {
    const one = outsideGroups([out('A-1', 'label', null, 'Manual'), out('A-2', 'label', null, 'manual')], new Set())
    expect(one[0]!.labels).toBe(false)
    const two = outsideGroups([out('A-1', 'label', null, 'Manual'), out('A-2', 'label', null, 'Вручную')], new Set())
    expect(two[0]!.labels).toBe(true)
  })
})

describe('outsidePage', () => {
  const many = (count: number, label: string) => Array.from({ length: count }, (_, index) => out(`A-${label}${index + 1}`, 'milestone', milestone(label)))

  it('shows a group whole while it fits the page', () => {
    const [group] = outsideGroups(many(3, 'v1'), new Set())
    const page = outsidePage(group!, 0)
    expect(page.sections.map((section) => [section.milestone?.label, section.count, section.tasks.length])).toEqual([['v1', 3, 3]])
    expect(page.hidden).toBe(0)
  })

  it('cuts the group at the page across its milestones, the rest under the same milestone heading after a press', () => {
    const [group] = outsideGroups([...many(30, 'v1'), ...many(40, 'v2')], new Set())
    const first = outsidePage(group!, 0)
    expect(first.sections.map((section) => [section.milestone?.label, section.count, section.tasks.length])).toEqual([
      ['v1', 30, 30],
      ['v2', 40, CHAIN_PAGE - 30],
    ])
    expect([first.hidden, first.next]).toEqual([70 - CHAIN_PAGE, CHAIN_MORE])
    const second = outsidePage(group!, 1)
    expect(second.sections.map((section) => section.tasks.length)).toEqual([30, CHAIN_PAGE + CHAIN_MORE - 30])
    expect(second.hidden).toBe(70 - CHAIN_PAGE - CHAIN_MORE)
  })
})

describe('open groups', () => {
  it('opens the label and status groups by default and keeps a saved choice, an empty one too', () => {
    expect(parseOpen(null)).toEqual(['label', 'status'])
    expect(parseOpen('')).toEqual([])
    expect(parseOpen('milestone,bogus')).toEqual(['milestone'])
    expect(openText(['status', 'milestone'])).toBe('status,milestone')
  })
})
