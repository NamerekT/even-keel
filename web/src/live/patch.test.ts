import { describe, expect, it } from 'vitest'
import { applyPatch } from './patch.js'

const session = (sessionId: string, lamp: string) => ({ sessionId, lamp })

describe('applyPatch', () => {
  const base = { a: 1, b: { c: 1 }, sessions: [session('s-1', 'working'), session('s-2', 'finished')] }

  it('replaces the parts sent whole, drops the parts gone and keeps the rest as they were', () => {
    const next = applyPatch(base, { parts: { a: 2 }, gone: ['b'] })
    expect(next).toEqual({ a: 2, sessions: base.sessions })
    expect(next.sessions).toBe(base.sessions)
    expect(base).toEqual({ a: 1, b: { c: 1 }, sessions: [session('s-1', 'working'), session('s-2', 'finished')] })
  })

  it('puts the changed entries of a keyed part in their places, keeping the order and the others', () => {
    const next = applyPatch(base, { keyed: { sessions: { by: 'sessionId', changed: [session('s-1', 'finished')] } } })
    expect(next.sessions).toEqual([session('s-1', 'finished'), session('s-2', 'finished')])
    expect(next.sessions[1]).toBe(base.sessions[1])
  })

  it('lays a keyed part out by the order sent, with new entries and without the dropped ones', () => {
    const next = applyPatch(base, { keyed: { sessions: { by: 'sessionId', order: ['s-3', 's-2'], changed: [session('s-3', 'working')] } } })
    expect(next.sessions).toEqual([session('s-3', 'working'), session('s-2', 'finished')])
  })
})
