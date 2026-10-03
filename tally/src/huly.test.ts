import { describe, expect, it } from 'vitest'
import { taskRecords, unknownRelations } from './huly.js'

const issues = [
  { _id: 'i1', identifier: 'CBL-458', title: 'Redo the menu', status: 's1', relations: [{ _id: 'i2' }, { _id: 'i9' }] },
  { _id: 'i2', identifier: 'CBL-426', title: 'Menu', status: 's2' },
]
const statuses = [
  { _id: 's1', name: 'In Progress' },
  { _id: 's2', name: 'Done' },
]
const labels = [
  { attachedTo: 'i1', title: ' Переделка ' },
  { attachedTo: 'i1', title: 'Opus' },
  { attachedTo: 'i1', title: 'переделка' },
]

describe('taskRecords', () => {
  it('names statuses, labels and related issues', () => {
    expect(taskRecords(issues, statuses, labels, new Map([['i9', 'CBL-12']]))).toEqual([
      { task: 'CBL-458', title: 'Redo the menu', status: 'In Progress', labels: ['Переделка', 'Opus'], related: ['CBL-426', 'CBL-12'] },
      { task: 'CBL-426', title: 'Menu', status: 'Done', labels: [], related: ['CBL-458'] },
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
