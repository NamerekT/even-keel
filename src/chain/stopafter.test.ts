import { describe, expect, it } from 'vitest'
import { done, setup, task } from './dispatcher.fixture.js'
import { emptyChainState } from './dispatcher.js'

describe('Dispatcher stopping after the current task', () => {
  it('cleans up after the done task and stops instead of launching the next', async () => {
    const busy = new Set<string>()
    const { dispatcher, launched, finished } = setup({ busy })
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    dispatcher.stopAfter('ABC', true)
    await dispatcher.idle()
    expect(dispatcher.state.active[0]).toMatchObject({ current: { task: 'ABC-1' }, stopAfter: true })

    busy.add('ABC-1')
    dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2')])
    await dispatcher.idle()
    expect(dispatcher.state.active[0]).toMatchObject({ closing: 'ABC-1', stopAfter: true })

    busy.clear()
    dispatcher.check()
    await dispatcher.idle()
    expect(finished).toEqual(['ABC/ABC-1'])
    expect(launched).toEqual(['ABC/ABC-1'])
    expect(dispatcher.state.active).toEqual([])
  })

  it('goes on to the next task once the flag is taken back', async () => {
    const { dispatcher, launched } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    dispatcher.stopAfter('ABC', true)
    dispatcher.stopAfter('ABC', false)
    await dispatcher.idle()
    expect(dispatcher.state.active[0]?.stopAfter).toBeUndefined()

    dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2')])
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
  })

  it('keeps the flag over a restart', async () => {
    const state = { ...emptyChainState(), active: [{ project: 'ABC', current: null, paused: false, error: null, closing: 'ABC-1', stopAfter: true as const }] }
    const { dispatcher, finished, launched } = setup({ state })
    dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2')])
    await dispatcher.idle()
    expect(finished).toEqual(['ABC/ABC-1'])
    expect(launched).toEqual([])
    expect(dispatcher.state.active).toEqual([])
  })

  it('gives the place to the next project of the queue', async () => {
    const { dispatcher, launched } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.setTasks('XYZ', [task('XYZ-1')])
    dispatcher.start('ABC')
    dispatcher.start('XYZ')
    await dispatcher.idle()
    expect(dispatcher.state.queue).toEqual(['XYZ'])

    dispatcher.stopAfter('ABC', true)
    dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2')])
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'XYZ/XYZ-1'])
    expect(dispatcher.state.active.map((chain) => chain.project)).toEqual(['XYZ'])
  })

  it('does nothing for a project without an active chain', async () => {
    const { dispatcher } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1')])
    dispatcher.stopAfter('ABC', true)
    await dispatcher.idle()
    expect(dispatcher.state.active).toEqual([])
  })
})
