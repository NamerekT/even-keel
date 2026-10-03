import { describe, expect, it } from 'vitest'
import { taskRecords, unknownRelations } from './huly.js'

const issues = [
  {
    _id: 'i1', identifier: 'CBL-458', title: 'Redo the menu', status: 's1', relations: [{ _id: 'i2' }, { _id: 'i9' }],
    priority: 2, estimation: 1.5, component: 'c1',
  },
  { _id: 'i2', identifier: 'CBL-426', title: 'Menu', status: 's2', priority: 0, estimation: 0, component: null },
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

describe('taskRecords', () => {
  it('names statuses, labels, components and related issues', () => {
    expect(taskRecords(issues, statuses, labels, new Map([['i9', 'CBL-12']]), components)).toEqual([
      {
        task: 'CBL-458', title: 'Redo the menu', status: 'In Progress', labels: ['Переделка', 'Opus'], related: ['CBL-426', 'CBL-12'],
        priority: 'high', estimateH: 1.5, component: 'Меню', done: false,
      },
      {
        task: 'CBL-426', title: 'Menu', status: 'Done', labels: [], related: ['CBL-458'],
        priority: 'no-priority', estimateH: null, component: null, done: true,
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
