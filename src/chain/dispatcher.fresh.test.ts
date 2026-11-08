import { describe, expect, it } from 'vitest'
import { notice, type Notice } from '../notice/notice.js'
import { setup, task } from './dispatcher.fixture.js'

/** A user's Start goes only by a list read since the tracker last answered again (BTN-830). */
describe('Dispatcher: a chain starts by a fresh task list', () => {
  const unread = notice('chain.unread', { project: 'ABC', tracker: 'Huly' })

  it('reads the tracker anew when the list it has is stale, and starts once the read is fresh', async () => {
    let block: Notice | undefined = unread
    const { dispatcher, launched, tracker, refreshed } = setup({ listBlock: () => block })
    dispatcher.setTasks('ABC', [task('ABC-1')])
    tracker.ABC = [task('ABC-2')]
    const read = dispatcher.start('ABC')
    block = undefined
    await read
    await dispatcher.idle()
    expect(refreshed).toEqual(['ABC'])
    expect(launched).toEqual(['ABC/ABC-2'])
  })

  it('refuses the start while the list is still stale after the read, and says why', async () => {
    const { dispatcher, launched, refreshed, log } = setup({ listBlock: () => unread })
    dispatcher.setTasks('ABC', [task('ABC-1')])
    await expect(dispatcher.start('ABC')).rejects.toMatchObject({ notice: unread })
    expect(refreshed).toEqual(['ABC'])
    expect(launched).toEqual([])
    expect(dispatcher.state.active).toEqual([])
    expect(log).toEqual(['chain: ABC not started: its tasks have not been read from Huly since it answered again; wait for the next read'])
  })

  it('refuses a project on a turned-off profile without a paused chain left behind', async () => {
    const off = notice('profiles.disabled', { profile: 'Huly · work', id: 'work', project: 'ABC' })
    const { dispatcher } = setup({ listBlock: () => off })
    dispatcher.setTasks('ABC', [task('ABC-1')])
    await expect(dispatcher.start('ABC')).rejects.toMatchObject({ notice: off })
    expect(dispatcher.state.active).toEqual([])
    expect(dispatcher.state.queue).toEqual([])
  })
})
