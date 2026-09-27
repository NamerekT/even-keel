import { describe, expect, it } from 'vitest'
import type { HulyTask, TaskMilestone } from '../huly/model.js'
import { chainOrder, checkOrder, compareMilestones, nextTask, openBlockers, precedence } from './order.js'

const task = (id: string, ...blockedBy: string[]): HulyTask => ({
  id,
  title: id,
  status: { name: 'Todo', category: 'ToDo' },
  blockedBy,
  milestone: null,
})

const milestone = (label: string, targetDate = 0): TaskMilestone => ({ label, targetDate })
const v1 = milestone('v0.1 — first slice', 300)
const v2 = milestone('v0.2 — second slice', 200)
const inMilestone = (m: TaskMilestone, id: string, ...blockedBy: string[]): HulyTask => ({ ...task(id, ...blockedBy), milestone: m })

describe('chainOrder', () => {
  it('orders independent tasks by number', () => {
    expect(chainOrder([task('ABC-10'), task('ABC-2'), task('ABC-1')])).toEqual(['ABC-1', 'ABC-2', 'ABC-10'])
  })

  it('puts a blocker before the task it blocks', () => {
    expect(chainOrder([task('ABC-1', 'ABC-3'), task('ABC-2'), task('ABC-3', 'ABC-2')])).toEqual([
      'ABC-2',
      'ABC-3',
      'ABC-1',
    ])
  })

  it('resolves a diamond', () => {
    const tasks = [task('ABC-4', 'ABC-2', 'ABC-3'), task('ABC-3', 'ABC-1'), task('ABC-2', 'ABC-1'), task('ABC-1')]
    expect(chainOrder(tasks)).toEqual(['ABC-1', 'ABC-2', 'ABC-3', 'ABC-4'])
  })

  it('names exactly the tasks of a cycle', () => {
    const tasks = [task('ABC-1', 'ABC-2'), task('ABC-2', 'ABC-3'), task('ABC-3', 'ABC-1'), task('ABC-4', 'ABC-1'), task('ABC-5')]
    expect(() => chainOrder(tasks)).toThrow(/cycle: ABC-1 → ABC-2 → ABC-3 → ABC-1$/)
  })

  it('ignores blockers outside the list', () => {
    expect(chainOrder([task('ABC-2', 'XYZ-1'), task('ABC-1', 'ABC-9')])).toEqual(['ABC-1', 'ABC-2'])
  })

  it('follows the preferred order and places new tasks after it', () => {
    const tasks = [task('ABC-1'), task('ABC-2'), task('ABC-3'), task('ABC-4')]
    expect(chainOrder(tasks, ['ABC-3', 'ABC-9', 'ABC-1'])).toEqual(['ABC-3', 'ABC-1', 'ABC-2', 'ABC-4'])
  })

  it('lets a blocker override the preferred order', () => {
    const tasks = [task('ABC-1'), task('ABC-2', 'ABC-3'), task('ABC-3')]
    expect(chainOrder(tasks, ['ABC-2', 'ABC-1', 'ABC-3'])).toEqual(['ABC-1', 'ABC-3', 'ABC-2'])
  })
})

describe('chainOrder with milestones', () => {
  it('finishes an earlier milestone before starting a later one', () => {
    const tasks = [inMilestone(v2, 'ABC-1'), inMilestone(v1, 'ABC-2'), inMilestone(v2, 'ABC-3'), inMilestone(v1, 'ABC-4')]
    expect(chainOrder(tasks)).toEqual(['ABC-2', 'ABC-4', 'ABC-1', 'ABC-3'])
  })

  it('keeps the milestone order against the preferred order', () => {
    const tasks = [inMilestone(v1, 'ABC-1'), inMilestone(v2, 'ABC-2'), inMilestone(v1, 'ABC-3')]
    expect(chainOrder(tasks, ['ABC-2', 'ABC-3', 'ABC-1'])).toEqual(['ABC-3', 'ABC-1', 'ABC-2'])
  })

  it('puts tasks without a milestone last by default but lets the preferred order move them', () => {
    const tasks = [task('ABC-1'), inMilestone(v2, 'ABC-2'), inMilestone(v1, 'ABC-3')]
    expect(chainOrder(tasks)).toEqual(['ABC-3', 'ABC-2', 'ABC-1'])
    expect(chainOrder(tasks, ['ABC-1', 'ABC-3', 'ABC-2'])).toEqual(['ABC-1', 'ABC-3', 'ABC-2'])
  })

  it('lets a blocker without a milestone go first', () => {
    const tasks = [inMilestone(v1, 'ABC-1', 'ABC-2'), task('ABC-2')]
    expect(chainOrder(tasks)).toEqual(['ABC-2', 'ABC-1'])
  })

  it('names a blocker from a later milestone', () => {
    const tasks = [inMilestone(v1, 'ABC-1', 'ABC-2'), inMilestone(v2, 'ABC-2')]
    expect(() => chainOrder(tasks)).toThrow('chain: ABC-1 in v0.1 — first slice is blocked by ABC-2 in the later v0.2 — second slice')
  })

  it('names blockers that go against the milestone order through a task without one', () => {
    const tasks = [inMilestone(v1, 'ABC-1', 'ABC-3'), inMilestone(v2, 'ABC-2'), task('ABC-3', 'ABC-2')]
    expect(() => chainOrder(tasks)).toThrow(/blockers go against the milestone order: ABC-1 → ABC-3 → ABC-2 → ABC-1$/)
  })

  it('still names a plain blocker cycle as a cycle', () => {
    const tasks = [inMilestone(v1, 'ABC-1', 'ABC-2'), inMilestone(v1, 'ABC-2', 'ABC-1'), inMilestone(v2, 'ABC-3')]
    expect(() => chainOrder(tasks)).toThrow(/cycle: ABC-1 → ABC-2 → ABC-1$/)
  })
})

describe('compareMilestones', () => {
  const sorted = (...labels: [string, number][]) =>
    labels.map(([label, date]) => milestone(label, date)).sort(compareMilestones).map((m) => m.label)

  it('orders by the version in the label, not by text', () => {
    expect(sorted(['v0.10', 0], ['v0.2', 0], ['v1', 0], ['0.1 beta', 0])).toEqual(['0.1 beta', 'v0.2', 'v0.10', 'v1'])
  })

  it('puts milestones without a version after numbered ones, by target date', () => {
    expect(sorted(['Later', 100], ['Sooner', 50], ['v0.3', 900])).toEqual(['v0.3', 'Sooner', 'Later'])
  })

  it('breaks a version tie by target date', () => {
    expect(sorted(['v0.1 b', 20], ['v0.1 a', 10])).toEqual(['v0.1 a', 'v0.1 b'])
  })
})

describe('precedence', () => {
  it('lists blockers and the tasks of earlier milestones', () => {
    const tasks = [inMilestone(v1, 'ABC-1'), inMilestone(v2, 'ABC-2', 'ABC-4'), inMilestone(v1, 'ABC-3'), task('ABC-4', 'XYZ-1')]
    expect(precedence(tasks)).toEqual(
      new Map([
        ['ABC-1', []],
        ['ABC-2', ['ABC-4', 'ABC-1', 'ABC-3']],
        ['ABC-3', []],
        ['ABC-4', []],
      ]),
    )
  })
})

describe('checkOrder', () => {
  const tasks = [task('ABC-1'), task('ABC-2', 'ABC-1'), task('ABC-3')]

  it('accepts an order that keeps every blocker first', () => {
    expect(() => checkOrder(tasks, ['ABC-3', 'ABC-1', 'ABC-2'])).not.toThrow()
  })

  it('rejects a task placed before its blocker', () => {
    expect(() => checkOrder(tasks, ['ABC-2', 'ABC-3', 'ABC-1'])).toThrow('ABC-2 cannot go before ABC-1, which blocks it')
  })

  it('rejects unknown and repeated tasks', () => {
    expect(() => checkOrder(tasks, ['ABC-1', 'ABC-7'])).toThrow('ABC-7 is not an open task of this chain')
    expect(() => checkOrder(tasks, ['ABC-1', 'ABC-1'])).toThrow('ABC-1 appears twice')
  })

  it('rejects a task placed before a task of an earlier milestone', () => {
    const planned = [inMilestone(v1, 'ABC-1'), inMilestone(v2, 'ABC-2'), task('ABC-3')]
    expect(() => checkOrder(planned, ['ABC-3', 'ABC-1', 'ABC-2'])).not.toThrow()
    expect(() => checkOrder(planned, ['ABC-2', 'ABC-3', 'ABC-1'])).toThrow(
      'ABC-2 in v0.2 — second slice cannot go before ABC-1 in the earlier v0.1 — first slice',
    )
  })
})

describe('nextTask', () => {
  const tasks = [task('ABC-1'), task('ABC-2', 'ABC-1'), task('ABC-3', 'ABC-2'), task('ABC-4')]
  const order = ['ABC-1', 'ABC-2', 'ABC-3', 'ABC-4']

  it('takes the first task in order when nothing is skipped', () => {
    expect(nextTask(tasks, order, [])).toBe('ABC-1')
  })

  it('passes over a skipped task and everything waiting on it', () => {
    expect(nextTask(tasks, order, ['ABC-1'])).toBe('ABC-4')
    expect(nextTask(tasks, order, ['ABC-2'])).toBe('ABC-1')
  })

  it('finds nothing when every open task is skipped or waits on one', () => {
    expect(nextTask(tasks, order, ['ABC-1', 'ABC-4'])).toBeUndefined()
    expect(nextTask([], [], [])).toBeUndefined()
  })
})

describe('openBlockers', () => {
  it('lists the blockers that are open tasks of the chain', () => {
    const tasks = [task('ABC-1'), task('ABC-2', 'ABC-1', 'ABC-9', 'XYZ-1')]
    expect(openBlockers(tasks, 'ABC-2')).toEqual(['ABC-1'])
    expect(openBlockers(tasks, 'ABC-1')).toEqual([])
    expect(openBlockers(tasks, 'ABC-7')).toEqual([])
  })
})
