import { describe, expect, it } from 'vitest'
import { noticeOf } from '../notice/notice.js'
import { fakeTask } from '../tracker/fixture.js'
import type { Task, TaskMilestone, TaskPriority } from '../tracker/model.js'
import { chainOrder, checkOrder, precedence, withWaiting } from './order.js'

const task = (id: string, extra: Partial<Task> = {}): Task => fakeTask(id, extra)
const v1: TaskMilestone = { label: 'v0.1', targetDate: 100 }
const v2: TaskMilestone = { label: 'v0.2', targetDate: 200 }
const low: TaskPriority = 'low'

describe('a parent outside the list that blocks a task (BTN-1235)', () => {
  // ABC-1 is the parent: not in the chain, it holds ABC-2 and ABC-3 and closes only with its subtask ABC-9.
  const held = [task('ABC-2', { blockedBy: ['ABC-1'] }), task('ABC-3', { blockedBy: ['ABC-2'] })]

  it('puts its open subtasks of the list before the tasks it holds, whatever their priority', () => {
    const tasks = [...held, task('ABC-9', { parent: 'ABC-1', priority: low })]
    expect(chainOrder(tasks)).toEqual(['ABC-9', 'ABC-2', 'ABC-3'])
    expect(precedence(tasks).get('ABC-2')).toEqual(['ABC-9'])
  })

  it('reaches subtasks through a nested parent', () => {
    const tasks = [...held, task('ABC-9', { parent: 'ABC-5', ancestors: ['ABC-5', 'ABC-1'], priority: low })]
    expect(chainOrder(tasks)).toEqual(['ABC-9', 'ABC-2', 'ABC-3'])
  })

  it('leaves the order alone when none of its subtasks is in the list', () => {
    const tasks = [...held, task('ABC-4', { parent: 'ABC-7' })]
    expect(chainOrder(tasks)).toEqual(['ABC-2', 'ABC-3', 'ABC-4'])
  })

  it('refuses an order that puts the tasks it holds before its subtask', () => {
    const tasks = [...held, task('ABC-9', { parent: 'ABC-1' })]
    expect(noticeOf(catching(() => checkOrder(tasks, ['ABC-2', 'ABC-9', 'ABC-3'])))).toMatchObject({ code: 'order.blocked', params: { task: 'ABC-2', blocker: 'ABC-9' } })
    expect(() => checkOrder(tasks, ['ABC-9', 'ABC-2', 'ABC-3'])).not.toThrow()
  })

  it('holds its subtask to the milestone rule of a blocker', () => {
    const tasks = [task('ABC-2', { blockedBy: ['ABC-1'], milestone: v1 }), task('ABC-9', { parent: 'ABC-1', milestone: v2 })]
    expect(noticeOf(catching(() => chainOrder(tasks)))).toMatchObject({ code: 'order.later', params: { task: 'ABC-2', blocker: 'ABC-9' } })
  })

  it('names the parent in a cycle through its subtask', () => {
    const tasks = [task('ABC-2', { blockedBy: ['ABC-1'] }), task('ABC-9', { parent: 'ABC-1', blockedBy: ['ABC-2'] })]
    expect(noticeOf(catching(() => chainOrder(tasks)))).toMatchObject({ code: 'order.cycle', params: { path: 'ABC-2 → ABC-1 → ABC-9 → ABC-2' } })
  })
})

describe('a parent in the list', () => {
  it('goes after its subtasks of the list', () => {
    const tasks = [task('ABC-1'), task('ABC-2', { blockedBy: ['ABC-1'] }), task('ABC-9', { parent: 'ABC-1', priority: low })]
    expect(chainOrder(tasks)).toEqual(['ABC-9', 'ABC-1', 'ABC-2'])
  })
})

describe('withWaiting and a waiting parent', () => {
  it('shows the parent right after its last subtask, before the first task it holds', () => {
    const blockers = new Map([['ABC-2', ['ABC-1']]])
    const ancestors = new Map([['ABC-9', ['ABC-1']]])
    expect(withWaiting(['ABC-9', 'ABC-4', 'ABC-2'], ['ABC-1'], blockers, ancestors)).toEqual(['ABC-9', 'ABC-1', 'ABC-4', 'ABC-2'])
  })

  it('keeps the parent before the task it holds when the order puts the subtask later', () => {
    const blockers = new Map([['ABC-2', ['ABC-1']]])
    const ancestors = new Map([['ABC-9', ['ABC-1']]])
    expect(withWaiting(['ABC-2', 'ABC-9'], ['ABC-1'], blockers, ancestors)).toEqual(['ABC-1', 'ABC-2', 'ABC-9'])
  })

  it('places a blocker of the parent in front of it', () => {
    const blockers = new Map([['ABC-2', ['ABC-1']], ['ABC-1', ['ABC-8']]])
    const ancestors = new Map([['ABC-9', ['ABC-1']]])
    expect(withWaiting(['ABC-9', 'ABC-4', 'ABC-2'], ['ABC-1', 'ABC-8'], blockers, ancestors)).toEqual(['ABC-9', 'ABC-8', 'ABC-1', 'ABC-4', 'ABC-2'])
  })
})

function catching(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error('did not throw')
}
