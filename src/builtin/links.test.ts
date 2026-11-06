import { describe, expect, it } from 'vitest'
import { closesLoop, laterBlocker } from './links.js'

describe('closesLoop', () => {
  const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'x', to: 'a' }]

  it('finds a loop through any number of tasks', () => {
    expect(closesLoop(edges, 'c', 'a')).toBe(true)
    expect(closesLoop(edges, 'b', 'a')).toBe(true)
    expect(closesLoop(edges, 'c', 'x')).toBe(true)
  })

  it('a block alongside the others, or the same way again, closes none', () => {
    expect(closesLoop(edges, 'a', 'c')).toBe(false)
    expect(closesLoop(edges, 'x', 'b')).toBe(false)
    expect(closesLoop([{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }], 'c', 'a')).toBe(false)
  })
})

describe('laterBlocker', () => {
  const v = (label: string, targetDate: number | null = null) => ({ label, targetDate })

  it('a blocker of a later milestone is one, by version first', () => {
    expect(laterBlocker(v('v0.10'), v('v0.9'))).toBe(true)
    expect(laterBlocker(v('v0.9'), v('v0.10'))).toBe(false)
    expect(laterBlocker(v('v0.3'), v('V0.3'))).toBe(false)
    expect(laterBlocker(v('Spring', 2), v('Winter', 1))).toBe(true)
  })

  it('a side without a milestone fits anywhere', () => {
    expect(laterBlocker(null, v('v0.3'))).toBe(false)
    expect(laterBlocker(v('v0.3'), null)).toBe(false)
  })
})
