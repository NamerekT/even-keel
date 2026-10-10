import { describe, expect, it } from 'vitest'
import { launchLine } from './log.js'

const at = '2026-09-26T12:00:00.000Z'

describe('launchLine', () => {
  it('tells a start', () => {
    expect(launchLine({ at, project: 'ABC', task: 'ABC-1', sessionId: 'new-session' })).toBe('chain: ABC-1 started in the session new-session')
  })

  it('tells a handover and what caused it', () => {
    const entry = { at, project: 'ABC', task: 'ABC-1', sessionId: 'new-session', reason: 'checkpoint' as const, previous: 'old-session' }
    expect(launchLine(entry)).toBe('chain: ABC-1 handed over by checkpoint from the session old-session to new-session')
  })

  it('tells a release and the blockers behind a postpone', () => {
    expect(launchLine({ at, project: 'ABC', task: 'ABC-1', sessionId: 'old-session', reason: 'skip' })).toBe(
      'chain: ABC-1 released (skip), its session old-session is left as it is',
    )
    expect(launchLine({ at, project: 'ABC', task: 'ABC-1', sessionId: 'old-session', reason: 'postpone', blockers: ['ABC-2', 'ABC-3'] })).toBe(
      'chain: ABC-1 released (postpone, blocked by ABC-2, ABC-3), its session old-session is left as it is',
    )
  })
})
