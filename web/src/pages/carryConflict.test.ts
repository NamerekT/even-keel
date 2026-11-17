import { describe, expect, it } from 'vitest'
import { conflictBar, conflictLinesOf, conflictMax } from './carryConflict.js'

describe('conflictBar', () => {
  it('fills the five cells by the share of the largest file, at least one for a file with lines', () => {
    expect([41, 6, 10].map((lines) => conflictBar(lines, 41))).toEqual([5, 1, 1])
    expect([4, 11, 18, 25, 32, 39, 13].map((lines) => conflictBar(lines, 39))).toEqual([1, 1, 2, 3, 4, 5, 2])
  })

  it('fills nothing for a file with no lines or deleted on one side', () => {
    expect(conflictBar(0, 10)).toBe(0)
    expect(conflictBar(null, 10)).toBe(0)
    expect(conflictBar(0, 0)).toBe(0)
  })
})

describe('the totals of a conflict', () => {
  const files = [
    { path: 'src/a.ts', lines: 41 },
    { path: 'src/b.ts', lines: 6 },
    { path: 'src/gone.ts', lines: null },
  ]

  it('sums the lines and takes the largest, a deleted file adding nothing', () => {
    expect(conflictLinesOf(files)).toBe(47)
    expect(conflictMax(files)).toBe(41)
    expect(conflictMax([])).toBe(0)
  })
})
