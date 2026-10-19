import { describe, expect, it } from 'vitest'
import { holdKey, shownAsk, type HeldSession } from './composerHold.js'

const ASK = { id: 'toolu_1', questions: [] }

const session = (extra: Partial<HeldSession> = {}): HeldSession => ({
  sessionId: 's1',
  lamp: 'waiting',
  ask: null,
  lastActivityAt: '2026-10-19T10:00:00.000Z',
  ...extra,
})

describe('holdKey', () => {
  it('changes when a turn ended between two updates and the lamp stayed waiting', () => {
    expect(holdKey(session({ lastActivityAt: '2026-10-19T10:00:30.000Z' }))).not.toBe(holdKey(session()))
  })

  it('changes with the lamp and with a new question', () => {
    expect(holdKey(session({ lamp: 'working' }))).not.toBe(holdKey(session()))
    expect(holdKey(session({ ask: ASK }))).not.toBe(holdKey(session()))
  })

  it('stays while nothing of the session moved', () => {
    expect(holdKey(session({ ask: ASK }))).toBe(holdKey(session({ ask: { ...ASK } })))
  })
})

describe('shownAsk', () => {
  it('gives the open question', () => {
    expect(shownAsk(ASK, null)).toBe(ASK)
    expect(shownAsk(ASK, 'toolu_0')).toBe(ASK)
  })

  it('never gives the question already answered, which the job file may still hold', () => {
    expect(shownAsk(ASK, 'toolu_1')).toBeNull()
  })

  it('gives nothing without a question', () => {
    expect(shownAsk(null, 'toolu_1')).toBeNull()
  })
})
