import { describe, expect, it } from 'vitest'
import { issue } from './fixture.js'
import { linearPriority, linearStatus, toTrackerTask } from './model.js'

describe('linear status', () => {
  it('takes the category from the type of the workflow state and keeps its name', () => {
    expect(linearStatus({ name: 'Triage', type: 'triage' })).toEqual({ name: 'Triage', category: 'UnStarted' })
    expect(linearStatus({ name: 'Backlog', type: 'backlog' })).toEqual({ name: 'Backlog', category: 'UnStarted' })
    expect(linearStatus({ name: 'Todo', type: 'unstarted' })).toEqual({ name: 'Todo', category: 'ToDo' })
    expect(linearStatus({ name: 'In Review', type: 'started' })).toEqual({ name: 'In Review', category: 'Active' })
    expect(linearStatus({ name: 'Done', type: 'completed' })).toEqual({ name: 'Done', category: 'Won' })
    expect(linearStatus({ name: 'Canceled', type: 'canceled' })).toEqual({ name: 'Canceled', category: 'Lost' })
    expect(linearStatus({ name: 'Duplicate', type: 'duplicate' })).toEqual({ name: 'Duplicate', category: 'Lost' })
  })

  it('keeps a state of a type it does not know out of the chain without closing it', () => {
    expect(linearStatus({ name: 'Parked', type: 'parked' })).toEqual({ name: 'Parked', category: 'UnStarted' })
  })
})

describe('linear priority', () => {
  it('maps the native levels', () => {
    expect([1, 2, 3, 4, 0].map(linearPriority)).toEqual(['urgent', 'high', 'medium', 'low', 'none'])
  })

  it('is none for a level it does not know', () => {
    expect(linearPriority(7)).toBe('none')
  })
})

describe('linear issue to task', () => {
  it('takes the fields the chain needs', () => {
    const raw = issue('ENG-7', {
      title: 'Add login',
      priority: 2,
      state: { name: 'In Progress', type: 'started' },
      labels: { nodes: [{ name: 'Sonnet' }, { name: 'Bug' }] },
      projectMilestone: { id: 'm1', name: 'v1.0', targetDate: '2026-11-01' },
    })
    expect(toTrackerTask(raw)).toEqual({
      id: 'ENG-7',
      title: 'Add login',
      status: { name: 'In Progress', category: 'Active' },
      blockedBy: [],
      parent: null,
      subtasks: 0,
      milestone: { label: 'v1.0', targetDate: Date.parse('2026-11-01') },
      priority: 'high',
      labels: ['Sonnet', 'Bug'],
      estimate: 0,
    })
  })

  it('takes blockers from the inverse blocks relations only', () => {
    const raw = issue('ENG-7', {
      inverseRelations: {
        nodes: [
          { type: 'blocks', issue: { identifier: 'ENG-3' } },
          { type: 'related', issue: { identifier: 'ENG-4' } },
          { type: 'duplicate', issue: { identifier: 'ENG-5' } },
          { type: 'blocks', issue: { identifier: 'OPS-9' } },
        ],
      },
    })
    expect(toTrackerTask(raw).blockedBy).toEqual(['ENG-3', 'OPS-9'])
  })

  it('names the parent and counts the sub-issues', () => {
    const raw = issue('ENG-7', { parent: { identifier: 'ENG-1' }, children: { nodes: [{ id: 'a' }, { id: 'b' }] } })
    expect(toTrackerTask(raw)).toMatchObject({ parent: 'ENG-1', subtasks: 2 })
  })

  it('keeps a milestone without a target date', () => {
    const raw = issue('ENG-7', { projectMilestone: { id: 'm2', name: 'Later', targetDate: null } })
    expect(toTrackerTask(raw).milestone).toEqual({ label: 'Later', targetDate: null })
  })
})
