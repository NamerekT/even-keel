import { describe, expect, it } from 'vitest'
import type { TaskStatus } from '../tracker/model.js'
import { admits, DEFAULT_RULES, isActive, isDone, isTerminal, missingLabel, ownsMilestone, requiredOn, splitsMilestones, unknownStatuses, type ChainRules } from './rules.js'

const backlog: TaskStatus = { name: 'Backlog', category: 'UnStarted' }
const todo: TaskStatus = { name: 'Todo', category: 'ToDo' }
const progress: TaskStatus = { name: 'In Progress', category: 'Active' }
const review: TaskStatus = { name: 'In Review', category: 'Active' }
const done: TaskStatus = { name: 'Done', category: 'Won' }
const canceled: TaskStatus = { name: 'Canceled', category: 'Lost' }

const rules = (patch: Partial<ChainRules>): ChainRules => ({ ...DEFAULT_RULES, ...patch })

describe('default rules', () => {
  it('take ToDo and Active, close on Won and Lost, leave UnStarted out', () => {
    expect([backlog, todo, progress, review, done, canceled].map((status) => isActive(DEFAULT_RULES, status))).toEqual([
      false,
      true,
      true,
      true,
      false,
      false,
    ])
    expect([backlog, todo, review, done, canceled].map((status) => isTerminal(DEFAULT_RULES, status))).toEqual([
      false,
      false,
      false,
      true,
      true,
    ])
  })

  it('count only Won as done', () => {
    expect(isDone(DEFAULT_RULES, done)).toBe(true)
    expect(isDone(DEFAULT_RULES, canceled)).toBe(false)
  })

  it('keep a task labelled "Вручную" or "Manual" out, whatever its case and spacing', () => {
    expect(admits(DEFAULT_RULES, { status: todo, labels: [' вручную '] })).toBe(false)
    expect(admits(DEFAULT_RULES, { status: todo, labels: ['MANUAL'] })).toBe(false)
    expect(admits(DEFAULT_RULES, { status: todo, labels: ['Bug'] })).toBe(true)
  })

  it('keep a manual task out with a list of their own excluded labels too', () => {
    const own = { ...DEFAULT_RULES, excludedLabels: ['Bug'] }
    expect(admits(own, { status: todo, labels: ['Вручную'] })).toBe(false)
    expect(admits(own, { status: todo, labels: ['Manual'] })).toBe(false)
    expect(admits(own, { status: todo, labels: ['Bug'] })).toBe(false)
  })
})

describe('status names', () => {
  it('match active and terminal statuses by name, whatever the case and spacing', () => {
    const named = rules({ active: ['todo', ' In Progress '], terminal: ['In Review', 'Done'] })
    expect([backlog, todo, progress, review, done, canceled].map((status) => isActive(named, status))).toEqual([
      false,
      true,
      true,
      false,
      false,
      false,
    ])
    expect([todo, review, done, canceled].map((status) => isTerminal(named, status))).toEqual([false, true, true, false])
  })

  it('count a terminal status as done only in the Won category', () => {
    const named = rules({ terminal: ['In Review', 'Done'] })
    expect(isDone(named, review)).toBe(false)
    expect(isDone(named, done)).toBe(true)
  })

  it('keep the default for the list that is not given', () => {
    expect(isActive(rules({ terminal: ['Done'] }), review)).toBe(true)
    expect(isTerminal(rules({ active: ['Todo'] }), canceled)).toBe(true)
  })

  it('never take a terminal status as active', () => {
    expect(isActive(rules({ terminal: ['In Review'] }), review)).toBe(false)
  })

  it('name the listed statuses Huly does not have, once each', () => {
    const named = rules({ active: ['Todo', 'In Pogress'], terminal: ['done', 'Closed', 'Closed'] })
    expect(unknownStatuses(named, ['Backlog', 'Todo', 'In Progress', 'Done'])).toEqual(['In Pogress', 'Closed'])
    expect(unknownStatuses(DEFAULT_RULES, [])).toEqual([])
  })
})

describe('labels', () => {
  it('take any task when no label is required', () => {
    expect(admits(rules({ excludedLabels: [] }), { status: todo, labels: [] })).toBe(true)
  })

  it('need any one of the required labels, whatever its case and spacing', () => {
    const required = rules({ requiredLabels: ['Цепочка', 'Auto'] })
    expect(admits(required, { status: todo, labels: [] })).toBe(false)
    expect(admits(required, { status: todo, labels: ['Bug'] })).toBe(false)
    expect(admits(required, { status: todo, labels: [' AUTO '] })).toBe(true)
  })

  it('let an excluded label win over a required one', () => {
    const both = rules({ requiredLabels: ['Цепочка'], excludedLabels: ['Вручную'] })
    expect(admits(both, { status: todo, labels: ['Цепочка', 'Вручную'] })).toBe(false)
  })

  it('never admit a task in a terminal status', () => {
    expect(admits(DEFAULT_RULES, { status: done, labels: [] })).toBe(false)
  })

  it('name the label that lets a task in: the first required one, only for an open task without any', () => {
    const required = rules({ requiredLabels: ['Auto', 'Цепочка'], excludedLabels: ['Вручную'] })
    expect(missingLabel(required, { status: todo, labels: ['Bug'] })).toBe('Auto')
    expect(missingLabel(required, { status: backlog, labels: ['цепочка'] })).toBeNull()
    expect(missingLabel(required, { status: todo, labels: ['Вручную'] })).toBeNull()
    expect(missingLabel(required, { status: done, labels: [] })).toBeNull()
    expect(missingLabel(DEFAULT_RULES, { status: todo, labels: [] })).toBeNull()
  })

  it('name the required labels a task carries, as the tracker spells them', () => {
    const required = rules({ requiredLabels: ['Auto', 'Цепочка'] })
    expect(requiredOn(required, { labels: ['bug', ' auto ', 'Цепочка'] })).toEqual([' auto ', 'Цепочка'])
    expect(requiredOn(DEFAULT_RULES, { labels: ['Auto'] })).toEqual([])
  })
})

describe('milestones', () => {
  const in_ = (label: string | null) => ({ milestone: label === null ? null : { label, targetDate: null } })

  it('take a task in any milestone or none when no milestone is named', () => {
    expect(ownsMilestone(DEFAULT_RULES, in_(null))).toBe(true)
    expect(ownsMilestone(DEFAULT_RULES, in_('v0.2'))).toBe(true)
  })

  it('need one of the required milestones, whatever its case and spacing', () => {
    const release = rules({ requiredMilestones: ['v0.1.1', 'v0.1.2'] })
    expect(ownsMilestone(release, in_(null))).toBe(false)
    expect(ownsMilestone(release, in_('v0.2'))).toBe(false)
    expect(ownsMilestone(release, in_(' V0.1.2 '))).toBe(true)
  })

  it('leave out a task in an excluded milestone, and keep one without a milestone', () => {
    const dev = rules({ excludedMilestones: ['v0.1.1'] })
    expect(ownsMilestone(dev, in_('v0.1.1'))).toBe(false)
    expect(ownsMilestone(dev, in_('v0.2'))).toBe(true)
    expect(ownsMilestone(dev, in_(null))).toBe(true)
  })

  it('split two projects only when no milestone, nor the lack of one, is taken by both', () => {
    const release = rules({ requiredMilestones: ['v0.1.1'] })
    expect(splitsMilestones(release, rules({ excludedMilestones: ['V0.1.1'] }))).toBe(true)
    expect(splitsMilestones(rules({ excludedMilestones: ['v0.1.1'] }), release)).toBe(true)
    expect(splitsMilestones(release, rules({ requiredMilestones: ['v0.2'] }))).toBe(true)
    expect(splitsMilestones(release, DEFAULT_RULES)).toBe(false)
    expect(splitsMilestones(release, rules({ requiredMilestones: ['v0.2', 'v0.1.1'] }))).toBe(false)
    expect(splitsMilestones(rules({ excludedMilestones: ['v0.1.1'] }), rules({ excludedMilestones: ['v0.2'] }))).toBe(false)
  })
})
