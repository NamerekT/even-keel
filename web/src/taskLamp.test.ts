import { describe, expect, it } from 'vitest'
import { fakeTask } from '../../src/tracker/fixture.js'
import type { ActiveChainView, SessionView } from '../../src/state.js'
import type { LimitHold } from '../../src/chain/relay.js'
import { limitHeld, taskLamp } from './taskLamp.js'

const open = fakeTask('ABC-1', { status: { name: 'In Progress', category: 'Active' } })
const done = fakeTask('ABC-1', { status: { name: 'Done', category: 'Won' } })

const session = (lamp: SessionView['lamp']) => ({ lamp, checkpoint: false, asking: false, ask: null, waitingFor: null, startupDialog: null }) as unknown as SessionView

const hold = (patch: Partial<LimitHold> = {}): LimitHold => ({
  at: '2026-01-01T10:00:00.000Z',
  account: 'john@example.com',
  resetsAt: '2026-01-01T13:00:00.000Z',
  lastReplyAt: null,
  then: 'relay',
  acted: null,
  ...patch,
})

const lane = (limit?: LimitHold, task = 'ABC-1') =>
  ({ project: 'ABC', paused: false, current: { task, sessionId: 's', since: 't', ...(limit !== undefined && { limit }) } }) as unknown as ActiveChainView

describe('limitHeld', () => {
  it('holds the current task of a lane waiting for its limit to reset', () => {
    expect(limitHeld([lane(hold())], 'ABC-1')).toBe(true)
  })

  it('lets go once the wait is acted on, for a temporary model error and for another task', () => {
    expect(limitHeld([lane(hold({ acted: 'relay' }))], 'ABC-1')).toBe(false)
    expect(limitHeld([lane(hold({ transient: true }))], 'ABC-1')).toBe(false)
    expect(limitHeld([lane(hold(), 'ABC-2')], 'ABC-1')).toBe(false)
    expect(limitHeld([lane()], 'ABC-1')).toBe(false)
  })
})

describe('taskLamp', () => {
  it('lights an open task whose session finished on a limit the chain waits out as the limit, not as stopped', () => {
    expect(taskLamp(open, session('finished'), false, true)).toBe('limit')
    expect(taskLamp(open, null, false, true)).toBe('limit')
  })

  it('shows the finished session as stopped once the wait is acted on', () => {
    expect(taskLamp(open, session('finished'), false, limitHeld([lane(hold({ acted: 'relay' }))], 'ABC-1'))).toBe('stopped')
  })

  it('keeps the tracker status first', () => {
    expect(taskLamp(done, session('finished'), false, true)).toBe('done')
    expect(taskLamp(done, session('waiting'), false, false, true)).toBe('done')
  })

  it('lights a session whose merge is being landed as at work, not as a question or stopped (BTN-1779)', () => {
    expect(taskLamp(open, session('waiting'), false, false, true)).toBe('working')
    expect(taskLamp(open, session('finished'), false, false, true)).toBe('working')
    expect(taskLamp(open, session('waiting'))).toBe('waiting')
  })

  it('keeps a real question of a session whose merge is being landed', () => {
    expect(taskLamp(open, { ...session('waiting'), asking: true }, false, false, true)).toBe('waiting')
    expect(taskLamp(open, { ...session('waiting'), waitingFor: 'permission' } as SessionView, false, false, true)).toBe('waiting')
  })
})
