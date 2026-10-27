import { afterEach, describe, expect, it, vi } from 'vitest'
import { notice } from '../../src/notice/notice.js'
import { createFakeSource } from './live/fake.js'
import { cardTask, chainBlocks, waitingSessions } from './state.js'
import { completionNotices, completionTasks } from './completion.js'

afterEach(() => vi.useRealTimers())

function fixture() {
  vi.useFakeTimers()
  const state = createFakeSource('?chain=ask').snapshot().state!
  const session = state.sessions.find((each) => each.task === 'ABC-5')!
  session.asking = false
  session.ask = null
  state.sessions = [session]
  const tracker = state.trackers.find((each) => each.projects.includes('ABC'))!
  tracker.completionFailures = { ABC: [notice('tracker.completeRefused', { task: 'ABC-5' }, { detail: 'Due date required' })] }
  return { state, session, tracker }
}

describe('refused merged-task completion', () => {
  it('shows an error lamp on the card and row and removes the false header reply prompt', () => {
    const { state } = fixture()
    expect(cardTask(state, 'ABC')?.lamp).toBe('error')
    expect(chainBlocks(state, 'ABC').find((each) => each.id === 'ABC-5')?.lamp).toBe('error')
    expect(waitingSessions(state.sessions, state.tasks, completionTasks(state))).toEqual([])
    expect(completionNotices(state, 'ABC')).toHaveLength(1)
    expect(completionNotices(state, 'DEMO')).toEqual([])
  })

  it('keeps a real session question visible', () => {
    const { state, session } = fixture()
    session.asking = true
    expect(cardTask(state, 'ABC')?.lamp).toBe('waiting')
    expect(waitingSessions(state.sessions, state.tasks, completionTasks(state))).toEqual([session])
  })

  it('includes feed failures and hides them after the tracker reports the task closed', () => {
    const { state, tracker } = fixture()
    tracker.completionFailures = { 'feed-id': tracker.completionFailures!.ABC! }
    state.config.feeds.ABC = [{ id: 'feed-id' } as NonNullable<typeof state.config.feeds.ABC>[number]]
    expect(completionNotices(state, 'ABC')).toHaveLength(1)
    state.tasks.find((each) => each.id === 'ABC-5')!.status = { name: 'Done', category: 'Won' }
    expect(completionNotices(state, 'ABC')).toEqual([])
    expect(cardTask(state, 'ABC')?.lamp).toBe('done')
  })
})
