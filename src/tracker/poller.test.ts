import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeTask } from './fixture.js'
import { TrackerLink } from './link.js'
import type { StatusChange, Task, TaskStatus } from './model.js'
import { StatusPoller } from './poller.js'
import type { Tracker } from './source.js'

const todo: TaskStatus = { name: 'Todo', category: 'ToDo' }
const done: TaskStatus = { name: 'Done', category: 'Won' }
const task = (id: string, status: TaskStatus): Task => fakeTask(id, { status })

let world: Map<string, TaskStatus>
let failNext: boolean
let queried: string[][]

function source(): Tracker {
  return {
    chainTasks: async () => ({ tasks: [], unknownStatuses: [] }),
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
  const recovered = vi.fn()
  const connect = vi.fn(async () => source())
  const poller = new StatusPoller({
    link: new TrackerLink({ name: 'huly', connect, timeoutMs: 1000 }),
    watched,
    intervalMs: 5000,
    onChange: (batch) => changes.push(batch),
    onError: (error) => errors.push(error),
    onRecovered: recovered,
  })
  return { poller, changes, errors, connect, recovered }
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

  it('reports repeated failures once and recovers even when no status changed', async () => {
    const { poller, changes, errors, recovered } = makePoller(() => ['ABC-1'])
    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(recovered).not.toHaveBeenCalled()

    for (let attempt = 0; attempt < 3; attempt++) {
      failNext = true
      await vi.advanceTimersByTimeAsync(5000)
    }
    expect(errors).toHaveLength(1)
    expect(recovered).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(5000)
    expect(changes).toHaveLength(1)
    expect(recovered).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(recovered).toHaveBeenCalledTimes(1)

    failNext = true
    await vi.advanceTimersByTimeAsync(5000)
    expect(errors).toHaveLength(2)
    await poller.stop()
  })

  it('reports a changed error message or cause during an outage', async () => {
    const { poller, errors, connect } = makePoller(() => ['ABC-1'])
    let reason: unknown = new Error('fetch failed', { cause: new Error('refused') })
    connect.mockImplementation(async () => ({ ...source(), tasks: async () => { throw reason } }))
    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    reason = new Error('fetch failed', { cause: new Error('refused') })
    await vi.advanceTimersByTimeAsync(5000)
    expect(errors).toHaveLength(1)
    reason = new Error('fetch failed', { cause: new Error('DNS') })
    await vi.advanceTimersByTimeAsync(5000)
    expect(errors).toHaveLength(2)
    reason = 'token expired'
    await vi.advanceTimersByTimeAsync(5000)
    await vi.advanceTimersByTimeAsync(5000)
    expect(errors).toHaveLength(3)
    await poller.stop()
  })

  it('does not report recovery when there are no watched tasks to query', async () => {
    let watched = ['ABC-1']
    const { poller, errors, recovered } = makePoller(() => watched)
    failNext = true
    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    watched = []
    await vi.advanceTimersByTimeAsync(5000)
    expect(recovered).not.toHaveBeenCalled()
    watched = ['ABC-1']
    failNext = true
    await vi.advanceTimersByTimeAsync(5000)
    expect(errors).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(recovered).toHaveBeenCalledTimes(1)
    await poller.stop()
  })
})
