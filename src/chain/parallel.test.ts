import { describe, expect, it } from 'vitest'
import { done, setup, task } from './dispatcher.fixture.js'

const twoProjects = (options: Parameters<typeof setup>[0] = {}) => {
  const run = setup({ parallel: 2, ...options })
  run.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
  run.dispatcher.setTasks('XYZ', [task('XYZ-1')])
  run.dispatcher.setTasks('DEF', [task('DEF-1')])
  return run
}

describe('Dispatcher with parallel chains', () => {
  it('runs as many chains at once as allowed and queues the rest', async () => {
    const { dispatcher, launched } = twoProjects()
    dispatcher.start('ABC')
    dispatcher.start('XYZ')
    dispatcher.start('DEF')
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'XYZ/XYZ-1'])
    expect(dispatcher.state.active.map((chain) => chain.project)).toEqual(['ABC', 'XYZ'])
    expect(dispatcher.state.queue).toEqual(['DEF'])
  })

  it('starts the queued project when one chain ends while the other goes on', async () => {
    const { dispatcher, launched } = twoProjects()
    dispatcher.start('ABC')
    dispatcher.start('XYZ')
    dispatcher.start('DEF')
    await dispatcher.idle()

    dispatcher.setTasks('XYZ', [task('XYZ-1', done)])
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'XYZ/XYZ-1', 'DEF/DEF-1'])
    expect(dispatcher.state.active.map((chain) => chain.project)).toEqual(['ABC', 'DEF'])
    expect(dispatcher.state.active[0]?.current?.task).toBe('ABC-1')
  })

  it('pauses, resumes and stops only the named chain', async () => {
    const { dispatcher, launched } = twoProjects()
    dispatcher.start('ABC')
    dispatcher.start('XYZ')
    await dispatcher.idle()

    dispatcher.pause('ABC')
    dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2')])
    await dispatcher.idle()
    expect(dispatcher.state.active.map((chain) => chain.paused)).toEqual([true, false])
    expect(launched).toEqual(['ABC/ABC-1', 'XYZ/XYZ-1'])

    dispatcher.resume('ABC')
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'XYZ/XYZ-1', 'ABC/ABC-2'])

    dispatcher.stop('XYZ')
    await dispatcher.idle()
    expect(dispatcher.state.active.map((chain) => chain.project)).toEqual(['ABC'])
    expect(dispatcher.state.released['XYZ']).toEqual(['XYZ-1'])
  })

  it('holds every chain while the shared limit is used up', async () => {
    const { dispatcher, launched } = twoProjects({ limitReset: '2026-09-26T17:00:00.000Z' })
    dispatcher.start('ABC')
    dispatcher.start('XYZ')
    await dispatcher.idle()
    expect(launched).toEqual([])
    expect(dispatcher.state.active.map((chain) => chain.limitUntil)).toEqual(['2026-09-26T17:00:00.000Z', '2026-09-26T17:00:00.000Z'])
  })

  it('keeps running chains when the allowed number is lowered and takes no new one until below it', async () => {
    const { dispatcher, capacity } = twoProjects()
    dispatcher.start('ABC')
    dispatcher.start('XYZ')
    dispatcher.start('DEF')
    await dispatcher.idle()

    capacity.parallel = 1
    dispatcher.setTasks('XYZ', [task('XYZ-1', done)])
    await dispatcher.idle()
    expect(dispatcher.state.active.map((chain) => chain.project)).toEqual(['ABC'])
    expect(dispatcher.state.queue).toEqual(['DEF'])
  })

  it('starts a queued project at once when the allowed number grows', async () => {
    const { dispatcher, launched, capacity } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1')])
    dispatcher.setTasks('XYZ', [task('XYZ-1')])
    dispatcher.start('ABC')
    dispatcher.start('XYZ')
    await dispatcher.idle()

    capacity.parallel = 2
    dispatcher.check()
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'XYZ/XYZ-1'])
  })
})
