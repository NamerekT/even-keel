import { describe, expect, it } from 'vitest'
import type { ImportSource, ImportTask } from '../tracker/import.js'
import type { OpenedImportSource } from '../tracker/import-source.js'
import { countTasks } from '../tracker/import-plan.js'
import { PlanReads } from './import-reading.js'

const task = (number: number): ImportTask => ({
  ref: `r${number}`,
  number,
  id: `ABC-${number}`,
  title: `Task ${number}`,
  description: '',
  images: [],
  status: { name: 'Todo', category: 'ToDo' },
  priority: 'medium',
  milestone: null,
  component: null,
  labels: [],
  estimate: null,
  parent: null,
  blocks: [],
  blockedBy: [],
  related: [],
  createdAt: 0,
  createdBy: null,
  closedAt: null,
  modifiedAt: null,
})

/** A source of `count` tasks counting its journal reads; `fail` — the next journal read throws. */
function sourceOf(count: number) {
  const state = { comments: 0, inFlight: 0, most: 0, fail: false }
  const source: ImportSource = {
    tasks: async () => Array.from({ length: count }, (_, index) => task(index + 1)),
    milestones: async () => [],
    async comments() {
      state.comments += 1
      state.inFlight += 1
      state.most = Math.max(state.most, state.inFlight)
      await new Promise((resolve) => setTimeout(resolve, 2))
      state.inFlight -= 1
      if (state.fail) {
        state.fail = false
        throw new Error('the tracker is down')
      }
      return []
    },
    files: async () => [],
  }
  return { source, state }
}

function readsOf(source: ImportSource, keepMs = 1000) {
  const clock = { now: 0, opens: 0, closes: 0 }
  const opened = (tracker = 'huly'): OpenedImportSource => ({
    tracker,
    place: '',
    key: 'ABC',
    title: 'Huly',
    source,
    close: async () => {
      clock.closes += 1
    },
  })
  const reads = new PlanReads({
    open: async () => {
      clock.opens += 1
      return opened()
    },
    say: () => {},
    now: () => clock.now,
    keepMs,
  })
  return { reads, clock, opened }
}

describe("the import plan's read", () => {
  it('reads the tasks a few at once, telling how many are through', async () => {
    const { source, state } = sourceOf(10)
    const heard: [number, number][] = []
    const counted = await countTasks({ ...source, parallel: 3 }, (done, total) => heard.push([done, total]))
    expect(counted.map((each) => each.task.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(state.most).toBe(3)
    expect(heard[0]).toEqual([0, 10])
    expect(heard.at(-1)).toEqual([10, 10])
  })

  it('stops at the first failure', async () => {
    const { source, state } = sourceOf(20)
    state.fail = true
    await expect(countTasks({ ...source, parallel: 2 })).rejects.toThrow('the tracker is down')
    expect(state.comments).toBeLessThan(20)
  })

  it('keeps a read for its time after the last ask, then reads again', async () => {
    const { source, state } = sourceOf(2)
    const { reads, clock } = readsOf(source)
    await reads.get('p')
    clock.now = 900
    await reads.get('p')
    clock.now = 1800
    await reads.get('p')
    expect(state.comments).toBe(2)
    clock.now = 2900
    await reads.get('p')
    expect(state.comments).toBe(4)
    expect(clock).toMatchObject({ opens: 2, closes: 2 })
  })

  it('does not keep a read that failed', async () => {
    const { source, state } = sourceOf(2)
    const { reads, clock } = readsOf(source)
    state.fail = true
    await expect(reads.get('p')).rejects.toThrow('the tracker is down')
    expect(reads.planning('p')).toBeNull()
    expect((await reads.get('p')).counted).toHaveLength(2)
    expect(clock.opens).toBe(2)
  })

  it('gives the start the kept read of its tracker and drops it; another tracker is read again from the start\'s own source', async () => {
    const { source, state } = sourceOf(2)
    const { reads, clock, opened } = readsOf(source)
    await reads.get('p')
    expect((await reads.take('p', opened())).counted).toHaveLength(2)
    expect(state.comments).toBe(2)
    await reads.get('p')
    expect((await reads.take('p', opened('github'))).from.tracker).toBe('github')
    expect(state.comments).toBe(6)
    // The start's source is left open for its run.
    expect(clock).toMatchObject({ opens: 2, closes: 2 })
    await reads.get('p')
    expect(clock.opens).toBe(3)
  })

  it('stops a read going on: the source is asked no more and closed, the next ask reads again', async () => {
    const { source, state } = sourceOf(40)
    const { reads, clock } = readsOf({ ...source, parallel: 2 })
    const asked = reads.get('p')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(reads.stop('p')).toBe(true)
    await expect(asked).rejects.toMatchObject({ notice: { code: 'import.planStopped' } })
    const stoppedAt = state.comments
    expect(stoppedAt).toBeLessThan(40)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(state.comments).toBe(stoppedAt)
    expect(reads.planning('p')).toBeNull()
    expect(clock.closes).toBe(1)
    expect((await reads.get('p')).counted).toHaveLength(40)
    expect(clock.opens).toBe(2)
  })

  it('keeps a read that is through, and the start\'s own read, past a stop', async () => {
    const { source, state } = sourceOf(4)
    const { reads, opened } = readsOf(source)
    await reads.get('p')
    expect(reads.stop('p')).toBe(false)
    await reads.get('p')
    expect(state.comments).toBe(4)
    expect(reads.stop('q')).toBe(false)
    const taken = reads.take('q', opened())
    expect(reads.stop('q')).toBe(false)
    expect((await taken).counted).toHaveLength(4)
  })
})
