import { describe, expect, it } from 'vitest'
import type { Task } from '../tracker/model.js'
import { backlog, setup, task, todo } from './dispatcher.fixture.js'

const v1 = { label: 'v0.1', targetDate: null }
const v2 = { label: 'v0.2', targetDate: null }

/** ABC-1…ABC-5 in a manual order, ABC-5 held by ABC-9 from the backlog; by priority ABC-9 would stand second. */
function chain(blocker: Partial<Task> = {}, extra: Task[] = []): Task[] {
  return [
    { ...task('ABC-1'), priority: 'urgent' },
    task('ABC-2'),
    task('ABC-3'),
    task('ABC-4'),
    task('ABC-5', todo, 'ABC-9'),
    ...extra,
    { ...task('ABC-9', backlog), priority: 'high', ...blocker },
  ]
}

const ready = (tasks: Task[]) => tasks.map((each) => (each.id === 'ABC-9' ? { ...each, status: todo } : each))

describe('"Into the chain" on a locked blocker', () => {
  it('stands right before the task it holds, where it stood locked, rather than by its priority', () => {
    const { dispatcher } = setup()
    const tasks = chain()
    dispatcher.setTasks('ABC', tasks)
    dispatcher.reorder('ABC', ['ABC-1', 'ABC-2', 'ABC-3', 'ABC-4', 'ABC-5'])
    expect(dispatcher.orders().ABC?.landing?.['ABC-9']).toBe('ABC-5')

    dispatcher.setTasks('ABC', ready(tasks))
    expect(dispatcher.orders().ABC?.order).toEqual(['ABC-1', 'ABC-2', 'ABC-3', 'ABC-4', 'ABC-9', 'ABC-5'])
  })

  it('keeps before the held task past its own blocker in the chain', () => {
    const { dispatcher } = setup()
    const tasks = chain({ blockedBy: ['ABC-6'] }, [task('ABC-6')])
    dispatcher.setTasks('ABC', tasks)
    dispatcher.reorder('ABC', ['ABC-1', 'ABC-2', 'ABC-6', 'ABC-3', 'ABC-4', 'ABC-5'])
    expect(dispatcher.orders().ABC?.landing?.['ABC-9']).toBe('ABC-5')

    dispatcher.setTasks('ABC', ready(tasks))
    expect(dispatcher.orders().ABC?.order).toEqual(['ABC-1', 'ABC-2', 'ABC-6', 'ABC-3', 'ABC-4', 'ABC-9', 'ABC-5'])
  })

  it('comes after its own blocker in the chain that stands lower, and the held task with it', () => {
    const { dispatcher } = setup()
    const tasks = chain({ blockedBy: ['ABC-6'] }, [task('ABC-6')])
    dispatcher.setTasks('ABC', tasks)
    dispatcher.reorder('ABC', ['ABC-1', 'ABC-2', 'ABC-3', 'ABC-4', 'ABC-5', 'ABC-6'])
    expect(dispatcher.orders().ABC?.landing?.['ABC-9']).toBe('ABC-5')

    dispatcher.setTasks('ABC', ready(tasks))
    expect(dispatcher.orders().ABC?.order).toEqual(['ABC-1', 'ABC-2', 'ABC-3', 'ABC-4', 'ABC-6', 'ABC-9', 'ABC-5'])
  })

  it('stands right before the task it holds through another locked blocker, which stays locked between them', () => {
    const { dispatcher } = setup()
    const tasks = [...chain({ priority: 'none', blockedBy: ['ABC-8'] }), { ...task('ABC-8', backlog), priority: 'high' as const }]
    dispatcher.setTasks('ABC', tasks)
    dispatcher.reorder('ABC', ['ABC-1', 'ABC-2', 'ABC-3', 'ABC-4', 'ABC-5'])
    expect(dispatcher.orders().ABC?.landing?.['ABC-8']).toBe('ABC-5')

    dispatcher.setTasks('ABC', tasks.map((each) => (each.id === 'ABC-8' ? { ...each, status: todo } : each)))
    expect(dispatcher.orders().ABC).toMatchObject({ order: ['ABC-1', 'ABC-2', 'ABC-3', 'ABC-4', 'ABC-8', 'ABC-5'], waiting: ['ABC-9'] })
  })

  it('stands right after its last subtask when that comes before the held task, as it stood locked (BTN-1235)', () => {
    const { dispatcher } = setup()
    const tasks = chain().map((each) => (each.id === 'ABC-3' ? { ...each, parent: 'ABC-9' } : each))
    dispatcher.setTasks('ABC', tasks)
    dispatcher.reorder('ABC', ['ABC-1', 'ABC-2', 'ABC-3', 'ABC-4', 'ABC-5'])
    expect(dispatcher.orders().ABC?.landing?.['ABC-9']).toBe('ABC-4')

    dispatcher.setTasks('ABC', ready(tasks))
    expect(dispatcher.orders().ABC?.order).toEqual(['ABC-1', 'ABC-2', 'ABC-3', 'ABC-9', 'ABC-4', 'ABC-5'])
  })

  it('takes the nearest place its milestone allows when that comes earlier', () => {
    const { dispatcher } = setup()
    const tasks = chain({ milestone: v1 }).map((each) => (each.id === 'ABC-1' ? { ...each, milestone: v1 } : each.id === 'ABC-9' ? each : { ...each, milestone: v2 }))
    dispatcher.setTasks('ABC', tasks)
    dispatcher.reorder('ABC', ['ABC-1', 'ABC-2', 'ABC-3', 'ABC-4', 'ABC-5'])
    expect(dispatcher.orders().ABC?.landing?.['ABC-9']).toBe('ABC-2')

    dispatcher.setTasks('ABC', ready(tasks))
    expect(dispatcher.orders().ABC?.order).toEqual(['ABC-1', 'ABC-9', 'ABC-2', 'ABC-3', 'ABC-4', 'ABC-5'])
  })
})
