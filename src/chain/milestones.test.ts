import { describe, expect, it } from 'vitest'
import { fakeTask } from '../tracker/fixture.js'
import type { Task, TaskMilestone } from '../tracker/model.js'
import { activeMilestone, MilestoneFiller, type ChainView } from './milestones.js'

const v1: TaskMilestone = { label: 'v0.1', targetDate: null }
const v2: TaskMilestone = { label: 'v0.2', targetDate: null }

const task = (id: string, milestone: TaskMilestone | null = null, ...blockedBy: string[]): Task => fakeTask(id, { milestone, blockedBy })
const view = (tasks: Task[], current?: string, blockers: Task[] = []): ChainView => ({ tasks, blockers, current })

function setup(options: { enabled?: boolean; refuse?: string[]; fail?: string[] } = {}) {
  const calls: string[] = []
  const errors: string[] = []
  const switches = { enabled: options.enabled ?? true }
  const fail = new Set(options.fail ?? [])
  const filler = new MilestoneFiller({
    enabled: () => switches.enabled,
    assign: async (id, like) => {
      if (fail.has(id)) throw new Error(`tracker: ${id} failed`)
      calls.push(`${id} like ${like}`)
      return !(options.refuse ?? []).includes(id)
    },
    onError: (error) => errors.push((error as Error).message),
  })
  return { filler, calls, errors, switches, fail }
}

describe('activeMilestone', () => {
  it('is the milestone of the current task', () => {
    expect(activeMilestone([task('ABC-1', v1), task('ABC-2', v2)], 'ABC-2')?.id).toBe('ABC-2')
  })

  it('is the earliest milestone of the chain when the current task has none or there is no current task', () => {
    const tasks = [task('ABC-1'), task('ABC-2', v2), task('ABC-3', v1), task('ABC-4', v1)]
    expect(activeMilestone(tasks, 'ABC-1')?.id).toBe('ABC-3')
    expect(activeMilestone(tasks, undefined)?.id).toBe('ABC-3')
  })

  it('is none in a chain without milestones', () => {
    expect(activeMilestone([task('ABC-1'), task('ABC-2')], 'ABC-1')).toBeUndefined()
  })
})

describe('MilestoneFiller', () => {
  it('puts a task that entered the chain without a milestone into the active one', async () => {
    const { filler, calls } = setup()
    const filled = await filler.sweep('ABC', view([task('ABC-1', v1), task('ABC-2', v2), task('ABC-3')], 'ABC-2'))
    expect(filled).toEqual([{ task: 'ABC-3', like: 'ABC-2', milestone: 'v0.2' }])
    expect(calls).toEqual(['ABC-3 like ABC-2'])
  })

  it('does nothing while the setting is off', async () => {
    const { filler, calls } = setup({ enabled: false })
    expect(await filler.sweep('ABC', view([task('ABC-1', v1), task('ABC-2')]))).toEqual([])
    expect(calls).toEqual([])
  })

  it('fills a task once: a milestone cleared afterwards stays cleared', async () => {
    const { filler, calls } = setup()
    await filler.sweep('ABC', view([task('ABC-1', v1), task('ABC-2')]))
    await filler.sweep('ABC', view([task('ABC-1', v1), task('ABC-2', v1)]))
    await filler.sweep('ABC', view([task('ABC-1', v1), task('ABC-2')]))
    expect(calls).toEqual(['ABC-2 like ABC-1'])
  })

  it('leaves alone a task that entered with a milestone and lost it later', async () => {
    const { filler, calls } = setup()
    await filler.sweep('ABC', view([task('ABC-1', v1), task('ABC-2', v2)]))
    await filler.sweep('ABC', view([task('ABC-1', v1), task('ABC-2')]))
    expect(calls).toEqual([])
  })

  it('fills a task again when it left the chain and came back', async () => {
    const { filler, calls } = setup()
    await filler.sweep('ABC', view([task('ABC-1', v1), task('ABC-2')]))
    await filler.sweep('ABC', view([task('ABC-1', v1)]))
    await filler.sweep('ABC', view([task('ABC-1', v1), task('ABC-2')]))
    expect(calls).toEqual(['ABC-2 like ABC-1', 'ABC-2 like ABC-1'])
  })

  it('waits for a milestone to appear in a chain that has none', async () => {
    const { filler, calls } = setup()
    expect(await filler.sweep('ABC', view([task('ABC-1'), task('ABC-2')]))).toEqual([])
    await filler.sweep('ABC', view([task('ABC-1'), task('ABC-2'), task('ABC-3', v1)]))
    expect(calls).toEqual(['ABC-1 like ABC-3', 'ABC-2 like ABC-3'])
  })

  it('does not report a task the tracker left alone, and does not ask again', async () => {
    const { filler, calls } = setup({ refuse: ['ABC-2'] })
    const tasks = [task('ABC-1', v1), task('ABC-2')]
    expect(await filler.sweep('ABC', view(tasks))).toEqual([])
    await filler.sweep('ABC', view(tasks))
    expect(calls).toEqual(['ABC-2 like ABC-1'])
  })

  it('tries again after a tracker error', async () => {
    const { filler, calls, errors, fail } = setup({ fail: ['ABC-2'] })
    const tasks = [task('ABC-1', v1), task('ABC-2'), task('ABC-3')]
    expect(await filler.sweep('ABC', view(tasks))).toEqual([{ task: 'ABC-3', like: 'ABC-1', milestone: 'v0.1' }])
    expect(errors).toEqual(['tracker: ABC-2 failed'])
    fail.clear()
    expect(await filler.sweep('ABC', view(tasks))).toEqual([{ task: 'ABC-2', like: 'ABC-1', milestone: 'v0.1' }])
    expect(calls).toEqual(['ABC-3 like ABC-1', 'ABC-2 like ABC-1'])
  })

  it('does not put a blocker into a later milestone than the task it holds', async () => {
    const { filler, calls } = setup()
    const tasks = [task('ABC-1', v1, 'ABC-3'), task('ABC-2', v2), task('ABC-3')]
    expect(await filler.sweep('ABC', view(tasks, 'ABC-2'))).toEqual([])
    expect(calls).toEqual([])
  })

  it('does not put a task into an earlier milestone than its blocker, even one still outside the chain', async () => {
    const { filler, calls } = setup()
    const inChain = [task('ABC-1', v1), task('ABC-2', v2), task('ABC-3', null, 'ABC-2')]
    expect(await filler.sweep('ABC', view(inChain, 'ABC-1'))).toEqual([])
    const waiting = [task('ABC-1', v1), task('ABC-3', null, 'ABC-4')]
    expect(await filler.sweep('XYZ', view(waiting, 'ABC-1', [task('ABC-4', v2)]))).toEqual([])
    expect(calls).toEqual([])
  })

  it('sees through a blocker without a milestone', async () => {
    const { filler, calls } = setup()
    const tasks = [task('ABC-1', v1, 'ABC-3'), task('ABC-2', v2), task('ABC-3', null, 'ABC-4'), task('ABC-4')]
    await filler.sweep('ABC', view(tasks, 'ABC-2'))
    expect(calls).toEqual([])
  })

  it('touches nothing while the order of the chain does not build', async () => {
    const { filler, calls } = setup()
    const broken = [task('ABC-1', v1, 'ABC-2'), task('ABC-2', v2), task('ABC-3')]
    expect(await filler.sweep('ABC', view(broken))).toEqual([])
    await filler.sweep('ABC', view([task('ABC-1', v1), task('ABC-2', v2), task('ABC-3')]))
    expect(calls).toEqual(['ABC-3 like ABC-1'])
  })

  it('starts over when the setting is turned on again', async () => {
    const { filler, calls, switches } = setup()
    const tasks = [task('ABC-1', v1), task('ABC-2')]
    await filler.sweep('ABC', view(tasks))
    switches.enabled = false
    await filler.sweep('ABC', view(tasks))
    switches.enabled = true
    await filler.sweep('ABC', view(tasks))
    expect(calls).toEqual(['ABC-2 like ABC-1', 'ABC-2 like ABC-1'])
  })
})
