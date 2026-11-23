import { describe, expect, it } from 'vitest'
import { done, fakeMachines, setup, task } from './dispatcher.fixture.js'

const lanesOf = (run: ReturnType<typeof setup>, project = 'ABC') =>
  run.dispatcher.state.active.filter((chain) => chain.project === project).map((chain) => [chain.machine, chain.current?.task ?? null])

describe('Dispatcher with machines (BTN-993)', () => {
  it('with one machine and width 1 runs as many projects as the machine holds, one task each', async () => {
    const { machines } = fakeMachines({ pc: 2 })
    const run = setup({ machines })
    run.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    run.dispatcher.setTasks('XYZ', [task('XYZ-1')])
    run.dispatcher.setTasks('DEF', [task('DEF-1')])
    await run.dispatcher.start('ABC')
    await run.dispatcher.start('XYZ')
    await run.dispatcher.start('DEF')
    await run.dispatcher.idle()
    expect(run.launched).toEqual(['ABC/ABC-1', 'XYZ/XYZ-1'])
    expect(run.dispatcher.state.queue).toEqual(['DEF'])
  })

  it('runs a project as wide as its width, each lane with a task of its own on a machine of its own', async () => {
    const { machines, bound } = fakeMachines({ pc: 1, server: 1, laptop: 1 }, { width: { ABC: 2 } })
    const run = setup({ machines })
    run.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2'), task('ABC-3')])
    await run.dispatcher.start('ABC')
    await run.dispatcher.idle()
    expect(run.launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
    expect(lanesOf(run)).toEqual([['pc', 'ABC-1'], ['server', 'ABC-2']])
    expect(bound).toEqual({ 'ABC-1': 'pc', 'ABC-2': 'server' })
  })

  it('never gives a machine a second lane of a project, whatever its free places (BTN-1569)', async () => {
    const { machines } = fakeMachines({ pc: 3 }, { width: { ABC: 2 } })
    const run = setup({ machines })
    run.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    await run.dispatcher.start('ABC')
    await run.dispatcher.idle()
    expect(run.launched).toEqual(['ABC/ABC-1'])
    expect(lanesOf(run)).toEqual([['pc', 'ABC-1']])
  })

  it('puts the second lane on the machine, not on the hub with places left that runs the first (BTN-1569)', async () => {
    const { machines, bound } = fakeMachines({ hub: 3, pc: 1 }, { width: { ABC: 2 } })
    const run = setup({ machines })
    run.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    await run.dispatcher.start('ABC')
    await run.dispatcher.idle()
    expect(lanesOf(run)).toEqual([['hub', 'ABC-1'], ['pc', 'ABC-2']])
    expect(bound).toEqual({ 'ABC-1': 'hub', 'ABC-2': 'pc' })
    expect(run.log).toContain('chain: ABC takes another lane, on machine pc')
  })

  it('ends a second lane of a project left on one machine by an older version once it is between tasks (BTN-1569)', async () => {
    const { machines } = fakeMachines({ pc: 3 }, { width: { ABC: 2 } })
    const run = setup({ machines })
    run.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2'), task('ABC-3')])
    await run.dispatcher.start('ABC')
    await run.dispatcher.idle()
    run.dispatcher.state.active.push({ ...run.dispatcher.state.active[0]!, current: { task: 'ABC-2', sessionId: 'session-2', since: '2026-09-26T10:00:00.000Z' } })
    expect(lanesOf(run)).toEqual([['pc', 'ABC-1'], ['pc', 'ABC-2']])

    run.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2', done), task('ABC-3')])
    await run.dispatcher.idle()
    expect(lanesOf(run)).toEqual([['pc', 'ABC-1']])
    expect(run.log).toContain('chain: a second lane of ABC on machine pc ends: a machine runs one task of a project at a time')
  })

  it('hands the next task to the machine with a free place', async () => {
    const { machines, bound } = fakeMachines({ pc: 1, server: 1 }, { width: { ABC: 2 } })
    const run = setup({ machines })
    run.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2'), task('ABC-3')])
    await run.dispatcher.start('ABC')
    await run.dispatcher.idle()
    expect(lanesOf(run)).toEqual([['pc', 'ABC-1'], ['server', 'ABC-2']])
    expect(bound).toEqual({ 'ABC-1': 'pc', 'ABC-2': 'server' })
  })

  it('gives no task while its blocker is open', async () => {
    const { machines } = fakeMachines({ pc: 1, server: 1 }, { width: { ABC: 2 } })
    const run = setup({ machines })
    run.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2', undefined, 'ABC-1'), task('ABC-3')])
    await run.dispatcher.start('ABC')
    await run.dispatcher.idle()
    expect(lanesOf(run)).toEqual([['pc', 'ABC-1'], ['server', 'ABC-3']])

    run.dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2'), task('ABC-3')])
    await run.dispatcher.idle()
    expect(lanesOf(run)).toEqual([['pc', 'ABC-2'], ['server', 'ABC-3']])
  })

  it('gives no second lane while the blocker is the only ready task', async () => {
    const { machines } = fakeMachines({ pc: 1, server: 1 }, { width: { ABC: 2 } })
    const run = setup({ machines })
    run.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2', undefined, 'ABC-1')])
    await run.dispatcher.start('ABC')
    await run.dispatcher.idle()
    expect(lanesOf(run)).toEqual([['pc', 'ABC-1']])
  })

  it('passes a task over for a machine that cannot run it and gives it the next ready one', async () => {
    const { machines } = fakeMachines({ pc: 1, server: 1 }, { width: { ABC: 2 }, runs: (_project, id, machine) => !(id === 'ABC-1' && machine === 'pc') })
    const run = setup({ machines })
    run.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    await run.dispatcher.start('ABC')
    await run.dispatcher.idle()
    expect(lanesOf(run)).toEqual([['pc', 'ABC-2'], ['server', 'ABC-1']])
  })

  it('leaves a task to the machine that holds it, even off the link', async () => {
    const { machines } = fakeMachines({ pc: 1, server: 1 }, { width: { ABC: 2 }, held: { 'ABC-1': 'laptop' } })
    const run = setup({ machines })
    run.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2'), task('ABC-3')])
    await run.dispatcher.start('ABC')
    await run.dispatcher.idle()
    expect(lanesOf(run)).toEqual([['pc', 'ABC-2'], ['server', 'ABC-3']])
  })

  it('takes nothing on a machine outside the project pool', async () => {
    const { machines } = fakeMachines({ pc: 1, server: 1 }, { width: { ABC: 2 }, serves: (_project, machine) => machine === 'server' })
    const run = setup({ machines })
    run.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    await run.dispatcher.start('ABC')
    await run.dispatcher.idle()
    expect(lanesOf(run)).toEqual([['server', 'ABC-1']])
  })

  it('drops a lane with nothing left while the other runs, and ends the chain with the last one', async () => {
    const { machines } = fakeMachines({ pc: 1, server: 1 }, { width: { ABC: 2 } })
    const run = setup({ machines })
    run.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    await run.dispatcher.start('ABC')
    await run.dispatcher.idle()

    run.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2', done)])
    await run.dispatcher.idle()
    expect(lanesOf(run)).toEqual([['pc', 'ABC-1']])
    expect(run.finished).toEqual(['ABC/ABC-2'])
    expect(run.log.some((line) => line.includes('ended'))).toBe(false)

    run.dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2', done)])
    await run.dispatcher.idle()
    expect(lanesOf(run)).toEqual([])
    expect(run.log).toContain('chain: ABC ended, no task left to run')
  })

  it('opens a second lane again once a task is ready', async () => {
    const { machines } = fakeMachines({ pc: 1, server: 1 }, { width: { ABC: 2 } })
    const run = setup({ machines })
    run.dispatcher.setTasks('ABC', [task('ABC-1')])
    await run.dispatcher.start('ABC')
    await run.dispatcher.idle()
    expect(lanesOf(run)).toEqual([['pc', 'ABC-1']])

    run.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    await run.dispatcher.idle()
    expect(lanesOf(run)).toEqual([['pc', 'ABC-1'], ['server', 'ABC-2']])
  })

  it('skips the task of the lane that runs it, and stops every lane of the project', async () => {
    const { machines } = fakeMachines({ pc: 1, server: 1 }, { width: { ABC: 2 } })
    const run = setup({ machines })
    run.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2'), task('ABC-3')])
    await run.dispatcher.start('ABC')
    await run.dispatcher.idle()

    run.dispatcher.skip('ABC', 'ABC-2')
    await run.dispatcher.idle()
    expect(lanesOf(run)).toEqual([['pc', 'ABC-1'], ['server', 'ABC-3']])

    run.dispatcher.stop('ABC')
    await run.dispatcher.idle()
    expect(lanesOf(run)).toEqual([])
    expect(run.dispatcher.state.released['ABC']).toEqual(['ABC-2', 'ABC-1', 'ABC-3'])
  })

  it('ends the lane of a revoked machine and leaves its task with that machine (BTN-1270)', async () => {
    const gone = new Set<string>()
    const { machines, bound, listed } = fakeMachines({ pc: 1, server: 1 }, { width: { ABC: 2 }, held: { 'ABC-2': 'server' }, gone })
    const run = setup({ machines })
    run.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2'), task('ABC-3')])
    await run.dispatcher.start('ABC')
    await run.dispatcher.idle()
    expect(lanesOf(run)).toEqual([['pc', 'ABC-1'], ['server', 'ABC-2']])

    gone.add('server')
    delete listed.server
    listed.laptop = 1
    run.dispatcher.check()
    await run.dispatcher.idle()
    expect(lanesOf(run)).toEqual([['pc', 'ABC-1'], ['laptop', 'ABC-3']])
    expect(bound['ABC-2']).toBe('server')
    expect(run.dispatcher.state.released['ABC'] ?? []).not.toContain('ABC-2')
  })

  it('takes a task moved off a machine gone into a lane elsewhere, never back on that machine', async () => {
    let moved = false
    const runs = (_project: string, task: string, machine: string) => !(moved && task === 'ABC-2' && machine === 'server')
    const { machines, bound, listed } = fakeMachines({ pc: 1, server: 1 }, { width: { ABC: 2 }, held: { 'ABC-2': 'server' }, runs })
    const run = setup({ machines })
    run.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    await run.dispatcher.start('ABC')
    await run.dispatcher.idle()
    expect(lanesOf(run)).toEqual([['pc', 'ABC-1'], ['server', 'ABC-2']])

    delete listed.server
    listed.laptop = 1
    moved = true
    delete bound['ABC-2']
    run.dispatcher.moved('ABC', 'ABC-2')
    await run.dispatcher.idle()
    expect(lanesOf(run)).toEqual([['pc', 'ABC-1'], ['laptop', 'ABC-2']])
    expect(bound['ABC-2']).toBe('laptop')
    expect(run.launched.filter((each) => each === 'ABC/ABC-2')).toHaveLength(2)
  })

  it('goes on with a project whose only lane was on the machine its task was moved off', async () => {
    let moved = false
    const runs = (_project: string, task: string, machine: string) => !(moved && task === 'ABC-1' && machine === 'server')
    const { machines, bound, listed } = fakeMachines({ pc: 1, server: 1 }, { held: { 'ABC-1': 'server' }, runs })
    const run = setup({ machines })
    run.dispatcher.setTasks('XYZ', [task('XYZ-1')])
    run.dispatcher.setTasks('ABC', [task('ABC-1')])
    await run.dispatcher.start('XYZ')
    await run.dispatcher.start('ABC')
    await run.dispatcher.idle()
    expect(lanesOf(run)).toEqual([['server', 'ABC-1']])

    delete listed.server
    moved = true
    delete bound['ABC-1']
    run.dispatcher.moved('ABC', 'ABC-1')
    await run.dispatcher.idle()
    expect(lanesOf(run)).toEqual([])
    expect(run.dispatcher.state.queue).toEqual(['ABC'])
  })

  it('fills a machine with lanes of several projects in the chain order, one of each', async () => {
    const { machines } = fakeMachines({ pc: 3 }, { width: { ABC: 2 } })
    const run = setup({ machines })
    run.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2'), task('ABC-3')])
    run.dispatcher.setTasks('XYZ', [task('XYZ-1')])
    run.dispatcher.setTasks('DEF', [task('DEF-1')])
    await run.dispatcher.start('ABC')
    await run.dispatcher.start('XYZ')
    await run.dispatcher.start('DEF')
    await run.dispatcher.idle()
    expect(run.launched.sort()).toEqual(['ABC/ABC-1', 'DEF/DEF-1', 'XYZ/XYZ-1'])
  })
})

describe('Lanes by component (BTN-1273)', () => {
  const tasks = () => [{ ...task('ABC-1'), component: 'UI' }, { ...task('ABC-2'), component: 'UI' }, { ...task('ABC-3'), component: 'Server' }]

  it('with the option off, lanes take tasks by the order whatever their components', async () => {
    const { machines } = fakeMachines({ pc: 1, server: 1 }, { width: { ABC: 2 } })
    const run = setup({ machines })
    run.dispatcher.setTasks('ABC', tasks())
    await run.dispatcher.start('ABC')
    await run.dispatcher.idle()
    expect(lanesOf(run)).toEqual([['pc', 'ABC-1'], ['server', 'ABC-2']])
  })

  it('with the option on, a lane passes over a task of the component a sibling lane runs', async () => {
    const { machines } = fakeMachines({ pc: 1, server: 1 }, { width: { ABC: 2 }, componentLanes: ['ABC'] })
    const run = setup({ machines })
    run.dispatcher.setTasks('ABC', tasks())
    await run.dispatcher.start('ABC')
    await run.dispatcher.idle()
    expect(lanesOf(run)).toEqual([['pc', 'ABC-1'], ['server', 'ABC-3']])
  })

  it('lets a task without a component go beside any lane, and one without a component beside it', async () => {
    const { machines } = fakeMachines({ pc: 1, server: 1, laptop: 1 }, { width: { ABC: 3 }, componentLanes: ['ABC'] })
    const run = setup({ machines })
    run.dispatcher.setTasks('ABC', [{ ...task('ABC-1'), component: 'UI' }, { ...task('ABC-2'), component: 'UI' }, task('ABC-3'), task('ABC-4')])
    await run.dispatcher.start('ABC')
    await run.dispatcher.idle()
    expect(lanesOf(run)).toEqual([['pc', 'ABC-1'], ['server', 'ABC-3'], ['laptop', 'ABC-4']])
  })

  it('opens no second lane while every ready task shares the component of the running one', async () => {
    const { machines } = fakeMachines({ pc: 1, server: 1 }, { width: { ABC: 2 }, componentLanes: ['ABC'] })
    const run = setup({ machines })
    run.dispatcher.setTasks('ABC', [{ ...task('ABC-1'), component: 'UI' }, { ...task('ABC-2'), component: 'UI' }])
    await run.dispatcher.start('ABC')
    await run.dispatcher.idle()
    expect(lanesOf(run)).toEqual([['pc', 'ABC-1']])
  })
})
