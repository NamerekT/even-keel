import { describe, expect, it } from 'vitest'
import { closeAcceptTurn, isAcceptClosed, parseAcceptClosed } from './acceptClosed.js'

const turn = (sessionId: string, at: string) => ({ sessionId, feed: [{ at, kind: 'text' as const, text: 'Done.' }] })

describe('the closed "Accept as answer" banner (BTN-1363)', () => {
  it('stays closed for the turn it was closed on', () => {
    const closed = closeAcceptTurn({}, turn('s1', '2026-11-20T10:00:00.000Z'))
    expect(isAcceptClosed(closed, turn('s1', '2026-11-20T10:00:00.000Z'))).toBe(true)
  })

  it('comes back on the next turn of the session and is not closed for another session', () => {
    const closed = closeAcceptTurn({}, turn('s1', '2026-11-20T10:00:00.000Z'))
    expect(isAcceptClosed(closed, turn('s1', '2026-11-20T10:05:00.000Z'))).toBe(false)
    expect(isAcceptClosed(closed, turn('s2', '2026-11-20T10:00:00.000Z'))).toBe(false)
  })

  it('keeps one turn a session and only the latest sessions', () => {
    let closed = closeAcceptTurn({}, turn('s1', 'a'))
    closed = closeAcceptTurn(closed, turn('s1', 'b'))
    expect(closed).toEqual({ s1: 'b' })
    for (let index = 0; index < 250; index++) closed = closeAcceptTurn(closed, turn(`n${index}`, 'a'))
    expect(Object.keys(closed)).toHaveLength(200)
    expect(closed.s1).toBeUndefined()
    expect(closed.n249).toBe('a')
  })

  it('a session with no line is never closed', () => {
    expect(closeAcceptTurn({}, { sessionId: 's1', feed: [] })).toEqual({})
    expect(isAcceptClosed({ s1: '' }, { sessionId: 's1', feed: [] })).toBe(false)
  })

  it('reads what the browser kept, and nothing from a broken value', () => {
    expect(parseAcceptClosed('{"s1":"a"}')).toEqual({ s1: 'a' })
    expect(parseAcceptClosed(null)).toEqual({})
    expect(parseAcceptClosed('[1]')).toEqual({})
    expect(parseAcceptClosed('{"s1":3}')).toEqual({})
    expect(parseAcceptClosed('nope')).toEqual({})
  })
})
