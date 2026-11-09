import { describe, expect, it } from 'vitest'
import type { Task, TaskPriority } from '../../../src/tracker/model.js'
import { BACKLOG_ORDERS, parseBacklogOrder, sortBacklog } from './backlogOrder.js'

const task = (id: string, priority: TaskPriority = 'none') => ({ id, priority }) as Task
const ids = (tasks: Task[]) => tasks.map((one) => one.id)

describe('sortBacklog', () => {
  const tasks = [task('BTN-9', 'low'), task('BTN-85', 'high'), task('BTN-10', 'urgent'), task('BTN-146', 'low'), task('BTN-2', 'none')]

  it('puts the newest task on top by its number, not by its text', () => {
    expect(ids(sortBacklog(tasks, 'new'))).toEqual(['BTN-146', 'BTN-85', 'BTN-10', 'BTN-9', 'BTN-2'])
  })

  it('puts the oldest on top', () => {
    expect(ids(sortBacklog(tasks, 'old'))).toEqual(['BTN-2', 'BTN-9', 'BTN-10', 'BTN-85', 'BTN-146'])
  })

  it('orders by priority, the newest first inside one priority', () => {
    expect(ids(sortBacklog(tasks, 'priority'))).toEqual(['BTN-10', 'BTN-85', 'BTN-146', 'BTN-9', 'BTN-2'])
  })

  it('leaves the list it was given as it was', () => {
    sortBacklog(tasks, 'new')
    expect(ids(tasks)).toEqual(['BTN-9', 'BTN-85', 'BTN-10', 'BTN-146', 'BTN-2'])
  })
})

describe('parseBacklogOrder', () => {
  it('takes a stored order and falls back to the newest first', () => {
    for (const order of BACKLOG_ORDERS) expect(parseBacklogOrder(order)).toBe(order)
    expect(parseBacklogOrder(null)).toBe('new')
    expect(parseBacklogOrder('milestone')).toBe('new')
  })
})
