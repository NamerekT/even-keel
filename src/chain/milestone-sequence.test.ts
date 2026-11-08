import { describe, expect, it } from 'vitest'
import { fakeTask } from '../tracker/fixture.js'
import type { TaskMilestone } from '../tracker/model.js'
import { backlog, done, setup, task, todo } from './dispatcher.fixture.js'
import { milestoneSequence, withMilestoneOrder } from './milestone-sequence.js'
import { chainOrder, checkOrder, precedence } from './order.js'

const m = (label: string, targetDate: number | null = null): TaskMilestone => ({ label, targetDate })
const labels = (sequence: { label: string; fresh: boolean }[]) => sequence.map((each) => (each.fresh ? `${each.label}*` : each.label))

describe('milestone sequence', () => {
  it('is the automatic order, each milestone once, without a saved order', () => {
    expect(labels(milestoneSequence([m('v0.3'), m('v0.1'), m('v0.2'), m('v0.1')], []))).toEqual(['v0.1', 'v0.2', 'v0.3'])
  })

  it('follows the saved order', () => {
    expect(labels(milestoneSequence([m('v0.1'), m('v0.2'), m('v0.3')], ['v0.3', 'v0.1', 'v0.2']))).toEqual(['v0.3', 'v0.1', 'v0.2'])
  })

  it('drops saved milestones no task carries any more', () => {
    expect(labels(milestoneSequence([m('MVP'), m('GA')], ['Beta', 'GA', 'Alpha', 'MVP']))).toEqual(['GA', 'MVP'])
  })

  it('puts a new milestone right after its automatic predecessor among the saved ones, marked new', () => {
    // Auto: v0.1 v0.2 v0.3 v0.4; saved: v0.3 v0.1 — v0.2 follows v0.1, v0.4 follows v0.3 by the automatic order.
    expect(labels(milestoneSequence([m('v0.1'), m('v0.2'), m('v0.3'), m('v0.4')], ['v0.3', 'v0.1']))).toEqual(['v0.3', 'v0.4*', 'v0.1', 'v0.2*'])
  })

  it('puts a new milestone with no saved predecessor first, new ones in their automatic order', () => {
    expect(labels(milestoneSequence([m('v0.1'), m('v0.2'), m('v0.5')], ['v0.5']))).toEqual(['v0.1*', 'v0.2*', 'v0.5'])
  })

  it('treats a renamed milestone as new', () => {
    expect(labels(milestoneSequence([m('v1 — core'), m('v2')], ['v2', 'v1']))).toEqual(['v1 — core*', 'v2'])
  })
})

describe('tasks under a manual milestone order', () => {
  const tasks = [
    fakeTask('ABC-1', { milestone: m('v0.1') }),
    fakeTask('ABC-2', { milestone: m('v0.2') }),
    fakeTask('ABC-3', { milestone: m('Beta') }),
    fakeTask('ABC-4'),
  ]

  it('leaves the tasks as they are without a saved order', () => {
    expect(withMilestoneOrder(tasks, [])).toBe(tasks)
    expect(chainOrder(tasks)).toEqual(['ABC-1', 'ABC-2', 'ABC-3', 'ABC-4'])
  })

  it('orders the chain, its check and its precedence by the saved order', () => {
    const manual = withMilestoneOrder(tasks, ['Beta', 'v0.2', 'v0.1'])
    expect(chainOrder(manual)).toEqual(['ABC-3', 'ABC-2', 'ABC-1', 'ABC-4'])
    expect(() => checkOrder(manual, ['ABC-3', 'ABC-2', 'ABC-1', 'ABC-4'])).not.toThrow()
    expect(() => checkOrder(manual, ['ABC-1', 'ABC-2', 'ABC-3', 'ABC-4'])).toThrow(/ABC-1 in v0.1 cannot go before ABC-2/)
    expect(precedence(manual).get('ABC-1')).toEqual(['ABC-2', 'ABC-3'])
  })

  it('lets a blocker of a later automatic milestone go first once the order puts it earlier', () => {
    const blocked = tasks.map((task) => (task.id === 'ABC-1' ? { ...task, blockedBy: ['ABC-2'] } : task))
    expect(() => chainOrder(blocked)).toThrow(/later v0.2/)
    // Beta is new: it follows v0.2, its automatic predecessor among the saved ones.
    expect(chainOrder(withMilestoneOrder(blocked, ['v0.2', 'v0.1']))).toEqual(['ABC-2', 'ABC-3', 'ABC-1', 'ABC-4'])
  })

  it('keeps one rank for one label across sources, whatever their dates', () => {
    const feeds = [fakeTask('ABC-1', { milestone: m('v1', 10) }), fakeTask('LIN-1', { milestone: m('v1', 99) }), fakeTask('ABC-2', { milestone: m('v2', 50) })]
    const manual = withMilestoneOrder(feeds, ['v2', 'v1'])
    expect(chainOrder(manual)).toEqual(['ABC-2', 'ABC-1', 'LIN-1'])
    expect(precedence(manual).get('LIN-1')).toEqual(['ABC-2'])
  })

  it('puts a new milestone with no saved predecessor before the saved ones', () => {
    const more = [...tasks, fakeTask('ABC-5', { milestone: m('v0.15', 0) })]
    // Auto: v0.15 (dated) first, so it has no saved predecessor and goes before the saved ones.
    expect(chainOrder(withMilestoneOrder(more, ['v0.2', 'v0.1', 'Beta']))).toEqual(['ABC-5', 'ABC-2', 'ABC-1', 'ABC-3', 'ABC-4'])
  })
})

describe('the dispatcher under a manual milestone order', () => {
  const v1 = m('v0.1')
  const v2 = m('v0.2')
  const listed = () => [
    { ...task('ABC-1', todo, 'ABC-2'), milestone: v1 },
    { ...task('ABC-2', backlog), milestone: v2 },
    { ...task('ABC-3', done), milestone: m('v0.0') },
    task('ABC-4', backlog),
  ]

  it('shows the automatic order of the live milestones without a saved one', () => {
    const { dispatcher } = setup()
    dispatcher.setTasks('ABC', listed())
    expect(dispatcher.orders()['ABC']?.milestones).toEqual([
      { label: 'v0.1', fresh: false },
      { label: 'v0.2', fresh: false },
    ])
    expect(dispatcher.orders()['ABC']?.refused?.['ABC-2']).toMatchObject({ code: 'order.later' })
  })

  it('takes the saved order live: the blocker of the later milestone lands once its milestone goes first', () => {
    const order: Record<string, string[]> = {}
    const { dispatcher } = setup({ milestoneOrder: order })
    order.ABC = ['v0.2', 'v0.1']
    dispatcher.setTasks('ABC', listed())
    expect(dispatcher.orders()['ABC']).toMatchObject({ order: ['ABC-1'], landing: { 'ABC-2': 'ABC-1', 'ABC-4': null }, error: null })
    expect(dispatcher.orders()['ABC']?.refused).toBeUndefined()
    expect(dispatcher.orders()['ABC']?.milestones).toEqual([
      { label: 'v0.2', fresh: false },
      { label: 'v0.1', fresh: false },
    ])
  })

  it('marks a milestone the saved order lacks as new', () => {
    const { dispatcher } = setup({ milestoneOrder: { ABC: ['v0.1'] } })
    dispatcher.setTasks('ABC', listed())
    expect(dispatcher.orders()['ABC']?.milestones).toEqual([
      { label: 'v0.1', fresh: false },
      { label: 'v0.2', fresh: true },
    ])
  })
})
