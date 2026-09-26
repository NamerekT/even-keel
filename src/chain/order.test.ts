import { describe, expect, it } from 'vitest'
import type { HulyTask } from '../huly/model.js'
import { chainOrder, checkOrder } from './order.js'

const task = (id: string, ...blockedBy: string[]): HulyTask => ({
  id,
  title: id,
  status: { name: 'Todo', category: 'ToDo' },
  blockedBy,
})

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
})
