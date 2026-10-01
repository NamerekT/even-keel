import { describe, expect, it } from 'vitest'
import { canceled, done, setup, task, todo } from './dispatcher.fixture.js'
import { emptyChainState } from './dispatcher.js'

describe('Dispatcher finishing a done task', () => {
  it('cleans up after the current task once it is done, then launches the next', async () => {
    const { dispatcher, launched, finished } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()
    expect(finished).toEqual([])

    dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2')])
    await dispatcher.idle()
    expect(finished).toEqual(['ABC/ABC-1'])
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
    expect(dispatcher.state.active?.closing).toBeUndefined()
  })

  it('waits until the session of the done task is not mid-turn', async () => {
    const busy = new Set<string>()
    const { dispatcher, launched, finished } = setup({ busy })
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    busy.add('ABC-1')
    dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2')])
    await dispatcher.idle()
    expect(finished).toEqual([])
    expect(launched).toEqual(['ABC/ABC-1'])
    expect(dispatcher.state.active).toMatchObject({ current: null, closing: 'ABC-1' })

    busy.clear()
    dispatcher.check()
    await dispatcher.idle()
    expect(finished).toEqual(['ABC/ABC-1'])
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
  })

  it('leaves a canceled or vanished task alone', async () => {
    const { dispatcher, finished, launched } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2'), task('ABC-3')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    dispatcher.setTasks('ABC', [task('ABC-1', canceled), task('ABC-2'), task('ABC-3')])
    await dispatcher.idle()
    dispatcher.setTasks('ABC', [task('ABC-3')])
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2', 'ABC/ABC-3'])
    expect(finished).toEqual([])
  })

  it('cleans up after the last task before the chain ends', async () => {
    const { dispatcher, finished } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    dispatcher.setTasks('ABC', [task('ABC-1', done)])
    await dispatcher.idle()
    expect(finished).toEqual(['ABC/ABC-1'])
    expect(dispatcher.state.active).toBeNull()
  })

  it('keeps the warnings of a cleanup and goes on', async () => {
    const { dispatcher, launched } = setup({ finish: () => ({ warnings: ['ABC-1: the worktree was kept'], syncError: null }) })
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2')])
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
    expect(dispatcher.state.leftovers).toEqual({
      ABC: [{ task: 'ABC-1', at: '2026-09-26T12:00:00.000Z', text: 'ABC-1: the worktree was kept' }],
    })

    dispatcher.dismiss('ABC', 'ABC-1')
    expect(dispatcher.state.leftovers).toEqual({})
  })

  it('pauses with the output when git sync fails, and goes on without it on resume', async () => {
    const { dispatcher, launched, finished } = setup({ finish: () => ({ warnings: [], syncError: 'sync: merge it by hand' }) })
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2')])
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1'])
    expect(dispatcher.state.active).toMatchObject({ paused: true, current: null, error: expect.stringMatching(/sync: merge it by hand/) })

    dispatcher.resume()
    await dispatcher.idle()
    expect(finished).toEqual(['ABC/ABC-1'])
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
  })

  it('picks up an unfinished cleanup after a restart', async () => {
    const state = { ...emptyChainState(), active: { project: 'ABC', current: null, paused: false, error: null, closing: 'ABC-1' } }
    const { dispatcher, finished, launched } = setup({ state })
    dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2')])
    await dispatcher.idle()
    expect(finished).toEqual(['ABC/ABC-1'])
    expect(launched).toEqual(['ABC/ABC-2'])
  })

  it('does not clean up after a done task the chain was not running', async () => {
    const { dispatcher, finished } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2', done)])
    await dispatcher.idle()
    expect(finished).toEqual([])
  })
})

describe('Dispatcher finishing a task it let go of', () => {
  it('cleans up after a task that left the chain once it is done', async () => {
    const { dispatcher, launched, finished } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    dispatcher.setTasks('ABC', [task('ABC-2')])
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
    expect(dispatcher.released('ABC')).toEqual(['ABC-1'])

    dispatcher.setReleased('ABC', [task('ABC-1')])
    await dispatcher.idle()
    expect(finished).toEqual([])

    dispatcher.setReleased('ABC', [task('ABC-1', done)])
    await dispatcher.idle()
    expect(finished).toEqual(['ABC/ABC-1'])
    expect(dispatcher.released('ABC')).toEqual([])
  })

  it('waits until the session of the released task is not mid-turn', async () => {
    const busy = new Set<string>()
    const { dispatcher, finished } = setup({ busy })
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()
    dispatcher.skip('ABC', 'ABC-1')
    await dispatcher.idle()

    busy.add('ABC-1')
    dispatcher.setReleased('ABC', [task('ABC-1', done)])
    await dispatcher.idle()
    expect(finished).toEqual([])

    busy.clear()
    dispatcher.check()
    await dispatcher.idle()
    expect(finished).toEqual(['ABC/ABC-1'])
  })

  it('cleans up after the current task of a stopped chain', async () => {
    const { dispatcher, finished } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1')])
    dispatcher.start('ABC')
    await dispatcher.idle()
    dispatcher.stop()
    expect(dispatcher.released('ABC')).toEqual(['ABC-1'])

    dispatcher.setReleased('ABC', [task('ABC-1', done)])
    await dispatcher.idle()
    expect(finished).toEqual(['ABC/ABC-1'])
  })

  it('forgets a released task that is canceled or gone from Huly', async () => {
    const { dispatcher, finished } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2'), task('ABC-3')])
    dispatcher.start('ABC')
    await dispatcher.idle()
    dispatcher.skip('ABC', 'ABC-1')
    await dispatcher.idle()
    dispatcher.skip('ABC', 'ABC-2')
    await dispatcher.idle()
    expect(dispatcher.released('ABC')).toEqual(['ABC-1', 'ABC-2'])

    dispatcher.setReleased('ABC', [task('ABC-1', canceled)])
    await dispatcher.idle()
    expect(dispatcher.released('ABC')).toEqual([])
    expect(dispatcher.state.released).toEqual({})
    expect(finished).toEqual([])
  })

  it('forgets a released task once the chain takes it again', async () => {
    const { dispatcher, launched, finished } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    dispatcher.setTasks('ABC', [task('ABC-1', todo, 'ABC-2'), task('ABC-2')])
    await dispatcher.idle()
    expect(dispatcher.released('ABC')).toEqual(['ABC-1'])

    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2', done)])
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2', 'ABC/ABC-1'])
    expect(finished).toEqual(['ABC/ABC-2'])
    expect(dispatcher.released('ABC')).toEqual([])
  })

  it('keeps the warnings and a failed sync of its cleanup without pausing the chain', async () => {
    const { dispatcher, launched } = setup({ finish: () => ({ warnings: ['ABC-1: the worktree was kept'], syncError: 'sync: merge it by hand' }) })
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()
    dispatcher.setTasks('ABC', [task('ABC-2')])
    await dispatcher.idle()

    dispatcher.setReleased('ABC', [task('ABC-1', done)])
    await dispatcher.idle()
    expect(dispatcher.state.active).toMatchObject({ paused: false, current: { task: 'ABC-2' } })
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
    expect(dispatcher.state.leftovers).toEqual({
      ABC: [
        { task: 'ABC-1', at: '2026-09-26T12:00:00.000Z', text: 'ABC-1: the worktree was kept' },
        { task: 'ABC-1', at: '2026-09-26T12:00:00.000Z', text: 'ABC-1: git sync failed: sync: merge it by hand' },
      ],
    })
  })
})
