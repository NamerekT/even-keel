import { describe, expect, it } from 'vitest'
import { fakeTask } from './fixture.js'
import type { Task, TaskStatus } from './model.js'
import { ParentCloser, parentRows } from './parents.js'

const done: TaskStatus = { name: 'Done', category: 'Won' }
const canceled: TaskStatus = { name: 'Canceled', category: 'Lost' }
const review: TaskStatus = { name: 'In Review', category: 'Active' }

function closerOf(children: Record<string, Task[]>) {
  const asked: string[] = []
  const completed: string[] = []
  const closer = new ParentCloser({
    children: async (parent) => {
      asked.push(parent)
      return children[parent] ?? []
    },
    complete: async (task) => completed.push(task) > 0,
  })
  return { closer, asked, completed }
}

const parent = (id: string) => fakeTask(id, { subtasks: 2, status: { name: 'In Progress', category: 'Active' } })
const child = (id: string, status: TaskStatus) => fakeTask(id, { parent: 'ABC-1', status })

describe('ParentCloser', () => {
  it('closes a parent once every subtask is closed and one of them is done', async () => {
    const { closer, completed } = closerOf({ 'ABC-1': [child('ABC-2', done), child('ABC-3', canceled)] })
    expect(await closer.sweep([parent('ABC-1')], [])).toEqual(['ABC-1'])
    expect(completed).toEqual(['ABC-1'])
  })

  it('does not ask the tracker about a parent with an open subtask among the chain tasks', async () => {
    const { closer, asked } = closerOf({})
    expect(await closer.sweep([parent('ABC-1')], [child('ABC-2', review)])).toEqual([])
    expect(asked).toEqual([])
  })

  it('counts a nested parent as an open subtask', async () => {
    const nested = fakeTask('ABC-2', { parent: 'ABC-1', subtasks: 1 })
    const { closer, asked } = closerOf({ 'ABC-2': [fakeTask('ABC-3', { parent: 'ABC-2' })] })
    expect(await closer.sweep([parent('ABC-1'), nested], [])).toEqual([])
    expect(asked).toEqual(['ABC-2'])
  })

  it('leaves a parent open while the tracker has a subtask open, whatever the chain rules hide', async () => {
    const { closer, completed } = closerOf({ 'ABC-1': [child('ABC-2', done), child('ABC-3', review)] })
    expect(await closer.sweep([parent('ABC-1')], [])).toEqual([])
    expect(completed).toEqual([])
  })

  it('leaves a parent whose subtasks were all canceled to the user', async () => {
    const { closer, completed } = closerOf({ 'ABC-1': [child('ABC-2', canceled), child('ABC-3', canceled)] })
    expect(await closer.sweep([parent('ABC-1')], [])).toEqual([])
    expect(completed).toEqual([])
  })

  it('leaves a parent without subtasks in the tracker alone', async () => {
    const { closer, completed } = closerOf({})
    expect(await closer.sweep([parent('ABC-1')], [])).toEqual([])
    expect(completed).toEqual([])
  })

  it('does not report a parent something else closed first', async () => {
    const closer = new ParentCloser({ children: async () => [child('ABC-2', done)], complete: async () => false })
    expect(await closer.sweep([parent('ABC-1')], [])).toEqual([])
  })

  it('reports a failure and goes on with the next parent', async () => {
    const errors: unknown[] = []
    const closer = new ParentCloser({
      children: async (id) => {
        if (id === 'ABC-1') throw new Error('tracker: down')
        return [fakeTask('ABC-6', { parent: id, status: done })]
      },
      complete: async () => true,
      onError: (error) => errors.push(error),
    })
    expect(await closer.sweep([parent('ABC-1'), parent('ABC-5')], [])).toEqual(['ABC-5'])
    expect(errors).toHaveLength(1)
  })
})

describe('parentRows', () => {
  it('counts the closed subtasks of each parent as all of them less the open ones it knows', () => {
    const top = fakeTask('ABC-1', { subtasks: 4 })
    const nested = fakeTask('ABC-4', { parent: 'ABC-1', subtasks: 1 })
    const rows = parentRows([top, nested], [child('ABC-2', review), child('ABC-3', done), fakeTask('ABC-5', { parent: 'ABC-4', status: done })])
    // Of the four subtasks of ABC-1 two are open: ABC-2 and the nested parent ABC-4; the done ABC-3 and one unread are closed.
    expect(rows.map((row) => [row.id, row.closedSubtasks])).toEqual([
      ['ABC-1', 2],
      ['ABC-4', 1],
    ])
  })

  it('never counts below zero when the tracker gave more open subtasks than it counted', () => {
    const one = fakeTask('ABC-1', { subtasks: 1 })
    expect(parentRows([one], [child('ABC-2', review), child('ABC-3', review)])[0]!.closedSubtasks).toBe(0)
  })
})
