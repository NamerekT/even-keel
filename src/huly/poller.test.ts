import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HulyLink } from './link.js'
import type { HulyTask, StatusChange, TaskStatus } from './model.js'
import { StatusPoller } from './poller.js'
import type { HulySource } from './source.js'

const todo: TaskStatus = { name: 'Todo', category: 'ToDo' }
const done: TaskStatus = { name: 'Done', category: 'Won' }
const task = (id: string, status: TaskStatus): HulyTask => ({ id, title: id, status, blockedBy: [], milestone: null, question: false, manual: false, models: [] })

let world: Map<string, TaskStatus>
let failNext: boolean
let queried: string[][]

function source(): HulySource {
  return {
    chainTasks: async () => [],
    tasks: async (ids) => {
      queried.push(ids)
      if (failNext) {
        failNext = false
        throw new Error('socket closed')
      }
      return ids.flatMap((id) => {
        const status = world.get(id)
        return status === undefined ? [] : [task(id, status)]
      })
    },
    close: async () => {},
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  world = new Map([['ABC-1', todo]])
  failNext = false
  queried = []
})

afterEach(() => {
  vi.useRealTimers()
})

function makePoller(watched: () => string[]) {
  const changes: StatusChange[][] = []
  const errors: unknown[] = []
  const connect = vi.fn(async () => source())
  const poller = new StatusPoller({
    link: new HulyLink({ connect, timeoutMs: 1000 }),
    watched,
    intervalMs: 5000,
    onChange: (batch) => changes.push(batch),
    onError: (error) => errors.push(error),
  })
  return { poller, changes, errors, connect }
}

describe('StatusPoller', () => {
  it('polls the watched tasks every interval and reports only what moved', async () => {
    const { poller, changes } = makePoller(() => ['ABC-1'])
    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(changes).toEqual([[{ id: 'ABC-1', from: null, to: todo }]])

    await vi.advanceTimersByTimeAsync(5000)
    expect(changes).toHaveLength(1)

    world.set('ABC-1', done)
    await vi.advanceTimersByTimeAsync(5000)
    expect(changes[1]).toEqual([{ id: 'ABC-1', from: todo, to: done }])
    expect(queried).toHaveLength(3)
    await poller.stop()
  })

  it('skips the query while nothing is watched', async () => {
    const { poller } = makePoller(() => [])
    poller.start()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(queried).toEqual([])
    await poller.stop()
  })

  it('reports an error, reconnects and keeps going', async () => {
    const { poller, changes, errors, connect } = makePoller(() => ['ABC-1'])
    failNext = true
    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(errors).toHaveLength(1)
    expect(changes).toEqual([])

    await vi.advanceTimersByTimeAsync(5000)
    expect(changes).toEqual([[{ id: 'ABC-1', from: null, to: todo }]])
    expect(connect).toHaveBeenCalledTimes(2)
    await poller.stop()
  })

  it('stops polling after stop()', async () => {
    const { poller } = makePoller(() => ['ABC-1'])
    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    await poller.stop()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(queried).toHaveLength(1)
  })
})
