import { describe, expect, it } from 'vitest'
import { patchOf, sameJson, type MachineFacts } from './facts.js'

const facts = (over: Partial<MachineFacts> = {}): MachineFacts => ({
  sessionsRead: true,
  accountsRead: true,
  tasks: {},
  projects: {},
  ledger: {},
  limits: {},
  resets: {},
  ...over,
})

describe('sameJson', () => {
  it('is what comparing the two JSON texts would say', () => {
    expect(sameJson({ a: 1, b: [1, { c: 'x' }] }, { a: 1, b: [1, { c: 'x' }] })).toBe(true)
    expect(sameJson({ a: 1, b: undefined }, { a: 1 })).toBe(true)
    expect(sameJson({ a: 1 }, { a: 1, b: null })).toBe(false)
    expect(sameJson({ a: 1 }, { a: 2 })).toBe(false)
    expect(sameJson([1, 2], [2, 1])).toBe(false)
    expect(sameJson([1], { 0: 1 })).toBe(false)
    expect(sameJson({ a: { b: 1 } }, { a: { b: 1, c: 2 } })).toBe(false)
    expect(sameJson(null, {})).toBe(false)
    expect(sameJson('1', 1)).toBe(false)
  })

  it('compares dates by their JSON', () => {
    expect(sameJson({ at: new Date('2026-11-16T12:00:00.000Z') }, { at: new Date('2026-11-16T12:00:00.000Z') })).toBe(true)
    expect(sameJson({ at: new Date('2026-11-16T12:00:00.000Z') }, { at: '2026-11-16T12:00:00.000Z' })).toBe(true)
  })
})

describe('patchOf', () => {
  it('posts nothing when the facts were built anew with the same values', () => {
    const before = facts({ tasks: { 'ABC-1': { live: 'session-1', asked: 'q' } }, limits: { main: null } })
    const after = facts({ tasks: { 'ABC-1': { asked: 'q', live: 'session-1' } }, limits: { main: null } })
    expect(patchOf(before, after)).toBeUndefined()
  })

  it('posts the entries that changed and the ones gone', () => {
    const before = facts({ tasks: { 'ABC-1': { live: 'session-1' }, 'ABC-2': { busy: true } }, accountsRead: false })
    const after = facts({ tasks: { 'ABC-1': { live: 'session-3' }, 'ABC-3': { shell: true } } })
    expect(patchOf(before, after)).toEqual({
      accountsRead: true,
      tasks: { set: { 'ABC-1': { live: 'session-3' }, 'ABC-3': { shell: true } }, gone: ['ABC-2'] },
    })
  })
})
