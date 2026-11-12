import { describe, expect, it } from 'vitest'
import { fakeTask } from '../tracker/fixture.js'
import type { TaskMilestone } from '../tracker/model.js'
import { activeMilestone } from './milestones.js'
import { chainOrder, checkOrder, compareMilestones, milestoneComparator } from './order.js'

const m = (label: string, targetDate: number | null = null): TaskMilestone => ({ label, targetDate })
const ordered = (label: string, value: number, source = 'linear:project-1'): TaskMilestone =>
  ({ ...m(label), trackerOrder: { source, value } })
const tasksOf = (milestones: TaskMilestone[]) => milestones.map((milestone, i) => fakeTask(`ABC-${i + 1}`, { milestone }))

describe('automatic milestone order', () => {
  it('uses dates before numbers, including quarters across years and unnumbered releases', () => {
    expect(compareMilestones(m('Q4 2026', 10), m('Q1 2027', 20))).toBeLessThan(0)
    expect(compareMilestones(m('Launch', 10), m('v1.1', 20))).toBeLessThan(0)
    expect(compareMilestones(m('v0.3', 10), m('v0.2', 20))).toBeLessThan(0)
  })

  it('keeps a total order with missing dates, versions and invalid dates', () => {
    const milestones = [m('v1', 30), m('v2'), m('v3', 10), m('MVP'), m('Beta'), m('GA', NaN), m('Sprint 10'), m('Sprint 9')]
    const expected = ['v3', 'v1', 'v2', 'Sprint 9', 'Sprint 10', 'Beta', 'GA', 'MVP']
    const compare = milestoneComparator(milestones)
    expect([...milestones].sort(compare).map((each) => each.label)).toEqual(expected)
    for (const a of milestones) for (const b of milestones) for (const c of milestones) {
      if (compare(a, b) <= 0 && compare(b, c) <= 0) expect(compare(a, c)).toBeLessThanOrEqual(0)
    }
    expect([...milestones].reverse().sort(compare).map((each) => each.label)).toEqual(expected)
  })

  it('uses native positions before dates and names, resolving equal positions by the fallback', () => {
    const milestones = [ordered('GA', 3), ordered('MVP', 1), ordered('Beta', 2), { ...ordered('Alpha', 2), targetDate: 1 }]
    expect([...milestones].sort(milestoneComparator(milestones)).map((each) => each.label)).toEqual(['MVP', 'Alpha', 'Beta', 'GA'])
  })

  it('ignores native positions for the whole set when sources differ or a position is missing', () => {
    for (const third of [ordered('v3', 0, 'linear:project'), m('v3'), ordered('v3', NaN)]) {
      const milestones = [ordered('v1', 2), ordered('v2', 1), third]
      const compare = milestoneComparator(milestones)
      expect([...milestones].sort(compare).map((each) => each.label)).toEqual(['v1', 'v2', 'v3'])
      expect(compare(milestones[0]!, milestones[2]!)).toBeLessThan(0)
      for (const a of milestones) for (const b of milestones) for (const c of milestones) {
        if (compare(a, b) <= 0 && compare(b, c) <= 0) expect(compare(a, c)).toBeLessThanOrEqual(0)
      }
    }
  })

  it('does not split matching feed milestones by their foreign positions', () => {
    const milestones = [ordered('v1', 1), ordered('v1', 10, 'linear:p1')]
    expect(milestoneComparator(milestones)(milestones[0]!, milestones[1]!)).toBe(0)
  })

  it('uses the same native order for the chain, order validation and active milestone', () => {
    const tasks = tasksOf([ordered('GA', 2), ordered('MVP', 0), ordered('Beta', 1)])
    expect(chainOrder(tasks)).toEqual(['ABC-2', 'ABC-3', 'ABC-1'])
    expect(chainOrder(tasks, ['ABC-1', 'ABC-3', 'ABC-2'])).toEqual(['ABC-2', 'ABC-3', 'ABC-1'])
    expect(() => checkOrder(tasks, ['ABC-2', 'ABC-3', 'ABC-1'])).not.toThrow()
    expect(() => checkOrder(tasks, ['ABC-1', 'ABC-2', 'ABC-3'])).toThrow()
    expect(activeMilestone(tasks, undefined)?.id).toBe('ABC-2')
    expect(chainOrder([...tasks].reverse())).toEqual(['ABC-2', 'ABC-3', 'ABC-1'])
    expect(() => chainOrder(tasks.map((task) => task.id === 'ABC-2' ? { ...task, blockedBy: ['ABC-1'] } : task)))
      .toThrow(/ABC-2 in MVP is blocked by ABC-1 in the later GA/)
  })
})
