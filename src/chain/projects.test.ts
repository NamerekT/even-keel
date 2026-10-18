import { describe, expect, it } from 'vitest'
import { setup, task } from './dispatcher.fixture.js'

describe('Dispatcher and the projects of the config', () => {
  it('forgets a project removed from the config: its chain stops and leaves the queue, its session is not stopped', async () => {
    const { dispatcher, stopped } = setup({ parallel: 1 })
    dispatcher.setTasks('ABC', [task('ABC-1')])
    dispatcher.setTasks('XYZ', [task('XYZ-1')])
    dispatcher.start('ABC')
    dispatcher.start('XYZ')
    await dispatcher.idle()
    expect(dispatcher.state.queue).toEqual(['XYZ'])

    dispatcher.forget('ABC')
    dispatcher.forget('XYZ')
    await dispatcher.idle()
    expect(dispatcher.state.active).toEqual([])
    expect(dispatcher.state.queue).toEqual([])
    expect(stopped).toEqual([])
    expect(dispatcher.orders()['ABC']).toBeUndefined()
  })

  it('carries the chain over to a renamed project key', async () => {
    const { dispatcher } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()
    dispatcher.skip('ABC', 'ABC-2')

    dispatcher.rekey((project) => (project === 'ABC' ? 'NEW' : project))
    expect(dispatcher.state.active.map((chain) => chain.project)).toEqual(['NEW'])
    expect(dispatcher.state.skipped).toEqual({ NEW: ['ABC-2'] })
    expect(dispatcher.orders()['NEW']).toBeDefined()
  })
})
