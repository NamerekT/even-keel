import { describe, expect, it } from 'vitest'
import type { SessionView } from '../../../src/state.js'
import { session } from '../live/fakeSessions.js'
import { offersAccept } from './acceptAnswer.js'

const ended = (patch: Partial<SessionView> = {}): SessionView => ({
  ...session('ABC-1', 40_000, 'waiting'),
  waitingFor: null,
  feed: [
    { at: '2026-11-09T10:00:00.000Z', kind: 'tool', text: 'Read README.md' },
    { at: '2026-11-09T10:01:00.000Z', kind: 'text', text: 'The library supports both formats.' },
  ],
  ...patch,
})

describe('offersAccept (BTN-885)', () => {
  it('offers a turn that ended in plain text, the process alive or gone', () => {
    expect(offersAccept(ended(), 'ABC-1', undefined, false)).toBe(true)
    expect(offersAccept(ended({ lamp: 'finished' }), 'ABC-1', undefined, false)).toBe(true)
  })

  it('does not offer a session at work, asking, on an error or limit, or about to hand over', () => {
    expect(offersAccept(ended({ lamp: 'working' }), 'ABC-1', undefined, false)).toBe(false)
    expect(offersAccept(ended({ waitingFor: 'permission' }), 'ABC-1', undefined, false)).toBe(false)
    expect(offersAccept(ended({ asking: true }), 'ABC-1', undefined, false)).toBe(false)
    expect(offersAccept(ended({ lamp: 'error' }), 'ABC-1', undefined, false)).toBe(false)
    expect(offersAccept(ended({ lamp: 'limit' }), 'ABC-1', undefined, false)).toBe(false)
    expect(offersAccept(ended({ apiError: 'overloaded', apiErrorKind: 'transient' }), 'ABC-1', undefined, false)).toBe(false)
    expect(offersAccept(ended({ checkpoint: true }), 'ABC-1', undefined, false)).toBe(false)
  })

  it('does not offer a turn that ended on a tool call or with no message', () => {
    expect(offersAccept(ended({ feed: [{ at: '2026-11-09T10:00:00.000Z', kind: 'tool', text: 'Bash npm test' }] }), 'ABC-1', undefined, false)).toBe(false)
    expect(offersAccept(ended({ feed: [] }), 'ABC-1', undefined, false)).toBe(false)
  })

  it('does not offer a folder with work main lacks, a merged task the tracker refused, or a fix of main', () => {
    expect(offersAccept(ended(), 'ABC-1', { path: 'C:/w', branch: 'abc-1/task', files: 0, ahead: 1 }, false)).toBe(false)
    expect(offersAccept(ended(), 'ABC-1', { path: 'C:/w', branch: 'abc-1/task', files: 2, ahead: 0 }, false)).toBe(false)
    expect(offersAccept(ended(), 'ABC-1', undefined, true)).toBe(false)
    expect(offersAccept(ended({ task: 'ABC-FIX.2' }), 'ABC-FIX.2', undefined, false)).toBe(false)
  })
})
