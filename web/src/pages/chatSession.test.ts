import { describe, expect, it } from 'vitest'
import type { SessionView } from '../../../src/state.js'
import { session } from '../live/fakeSessions.js'
import { chatSessionOf } from './chatSession.js'

const view = (lamp: SessionView['lamp'], sessionId = 'aaa'): SessionView => ({ ...session('ABC-1', 40_000, lamp), sessionId })

describe('chatSessionOf (BTN-1018)', () => {
  it('follows the session the chain talks to and reads it while it runs', () => {
    const talking = view('working')
    expect(chatSessionOf({ talking, last: talking, chatting: true, open: true, sessions: [talking] })).toEqual({ session: talking, live: true })
    expect(chatSessionOf({ talking, last: talking, chatting: false, open: true, sessions: [] })).toEqual({ session: talking, live: true })
  })

  it('keeps reading the last view of an open task while a reply respawns the session', () => {
    const last = view('working')
    expect(chatSessionOf({ talking: null, last, chatting: true, open: true, sessions: [] })).toEqual({ session: last, live: true })
    expect(chatSessionOf({ talking: null, last, chatting: false, open: true, sessions: [] })).toEqual({ session: null, live: false })
  })

  it('stops reading a finished session the chain still talks to', () => {
    const talking = view('finished')
    expect(chatSessionOf({ talking, last: talking, chatting: true, open: true, sessions: [talking] }).live).toBe(false)
  })

  it('after Done takes the last session from the state, so its turn is read to the end', () => {
    const last = view('working')
    const fresh = view('working')
    fresh.lastActivityAt = '2026-11-11T14:22:31.000Z'
    expect(chatSessionOf({ talking: null, last, chatting: true, open: false, sessions: [view('working', 'bbb'), fresh] })).toEqual({ session: fresh, live: true })
    const ended = view('finished')
    expect(chatSessionOf({ talking: null, last, chatting: true, open: false, sessions: [ended] })).toEqual({ session: ended, live: false })
    const idle = view('waiting')
    expect(chatSessionOf({ talking: null, last, chatting: true, open: false, sessions: [idle] }).session?.lamp).toBe('waiting')
  })

  it('after Done takes a session gone from the state for finished', () => {
    const last = view('working')
    expect(chatSessionOf({ talking: null, last, chatting: true, open: false, sessions: [] })).toEqual({ session: { ...last, lamp: 'finished' }, live: false })
  })
})
