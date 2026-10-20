import { describe, expect, it } from 'vitest'
import { done, setup, task } from './dispatcher.fixture.js'
import { emptyChainState } from './dispatcher.js'

describe('Dispatcher stopping after the session turn', () => {
  it('waits out the turn, then stops and takes nothing further', async () => {
    const busy = new Set<string>(['ABC-1'])
    const { dispatcher, launched } = setup({ busy })
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    dispatcher.stopAfter('ABC', true)
    await dispatcher.idle()
    expect(dispatcher.state.active[0]).toMatchObject({ current: { task: 'ABC-1' }, stopAfter: true })

    busy.clear()
    dispatcher.check()
    await dispatcher.idle()
    expect(dispatcher.state.active).toEqual([])
    expect(dispatcher.state.released.ABC).toEqual(['ABC-1'])
    expect(launched).toEqual(['ABC/ABC-1'])
  })

  it('stops at once when the session is not mid-turn, also on a question', async () => {
    const waiting = new Set<string>(['ABC-1'])
    const { dispatcher, launched } = setup({ waiting })
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    dispatcher.stopAfter('ABC', true)
    await dispatcher.idle()
    expect(dispatcher.state.active).toEqual([])
    expect(launched).toEqual(['ABC/ABC-1'])
  })

  it('does not follow the task to Done while the turn goes on', async () => {
    const busy = new Set<string>(['ABC-1'])
    const { dispatcher, finished } = setup({ busy })
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    dispatcher.stopAfter('ABC', true)
    dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2')])
    await dispatcher.idle()
    expect(dispatcher.state.active[0]).toMatchObject({ current: { task: 'ABC-1' }, stopAfter: true })
    expect(finished).toEqual([])
  })

  it('goes on to the next task once the flag is taken back', async () => {
    const busy = new Set<string>(['ABC-1'])
    const { dispatcher, launched } = setup({ busy })
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    dispatcher.stopAfter('ABC', true)
    dispatcher.stopAfter('ABC', false)
    await dispatcher.idle()
    expect(dispatcher.state.active[0]?.stopAfter).toBeUndefined()

    busy.clear()
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
