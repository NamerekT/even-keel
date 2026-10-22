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
})
