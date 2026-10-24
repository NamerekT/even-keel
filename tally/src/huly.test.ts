import { describe, expect, it } from 'vitest'
import { taskRecords, unknownRelations } from './huly.js'

const issues = [
  {
    _id: 'i1', identifier: 'GAME-458', title: 'Redo the menu', status: 's1', relations: [{ _id: 'i2' }, { _id: 'i9' }],
    priority: 2, estimation: 1.5, component: 'c1', milestone: 'm1', createdOn: Date.parse('2026-10-01T10:00:00Z'),
  },
  { _id: 'i2', identifier: 'GAME-426', title: 'Menu', status: 's2', priority: 0, estimation: 0, component: null, milestone: null },
]
const statuses = [
  { _id: 's1', name: 'In Progress', category: 'task:statusCategory:Active' },
  { _id: 's2', name: 'Done', category: 'task:statusCategory:Won' },
]
const labels = [
  { attachedTo: 'i1', title: ' Переделка ' },
  { attachedTo: 'i1', title: 'Opus' },
  { attachedTo: 'i1', title: 'переделка' },
]

const components = [{ _id: 'c1', label: 'Меню' }]
const milestones = [{ _id: 'm1', label: 'v1.0' }]

describe('taskRecords', () => {
  it('names statuses, labels, components, milestones and related issues', () => {
    expect(taskRecords(issues, statuses, labels, new Map([['i9', 'GAME-12']]), components, milestones)).toEqual([
      {
        task: 'GAME-458', title: 'Redo the menu', status: 'In Progress', labels: ['Переделка', 'Opus'], related: ['GAME-426', 'GAME-12'],
        priority: 'high', estimateH: 1.5, component: 'Меню', milestone: 'v1.0', done: false, createdAt: '2026-10-01T10:00:00.000Z',
      },
      {
        task: 'GAME-426', title: 'Menu', status: 'Done', labels: [], related: ['GAME-458'],
        priority: 'no-priority', estimateH: null, component: null, milestone: null, done: true, createdAt: null,
      },
    ])
  })

  it('drops a relation it cannot name', () => {
    expect(taskRecords(issues.slice(0, 1), statuses, [], new Map())[0]!.related).toEqual([])
  })
})

describe('unknownRelations', () => {
  it('lists related issues outside the fetched ones', () => {
    expect(unknownRelations(issues)).toEqual(['i9'])
  })
})
