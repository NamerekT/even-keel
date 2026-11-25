import { describe, expect, it } from 'vitest'
import { bracketPath, type BracketRow } from './bracketPath.js'

const row = (top: number, blocker = false, left = blocker ? 14 : 0, height = 34): BracketRow => ({ left, top, height, blocker })

describe('bracketPath', () => {
  it('draws nothing for a list without blockers', () => {
    expect(bracketPath([row(0), row(42)])).toBe('')
  })

  it('runs from a lone blocker with a rounded corner down to the top edge of the task it holds', () => {
    // The line stands halfway in the indent: x = 7.5; the blocker's middle is y = 17.5.
    expect(bracketPath([row(0), row(42, true), row(84)])).toBe('M14 59.5 H13.5 Q7.5 59.5 7.5 65.5 V84')
  })

  it('gives the other blockers of the run straight ticks from the same line', () => {
    expect(bracketPath([row(0, true), row(42, true), row(84)])).toBe('M14 17.5 H13.5 Q7.5 17.5 7.5 23.5 V84 M7.5 59.5 H14')
  })

  it('draws one bracket per run of blockers', () => {
    const d = bracketPath([row(0, true), row(42), row(84, true), row(126)])
    expect(d).toBe('M14 17.5 H13.5 Q7.5 17.5 7.5 23.5 V42 M14 101.5 H13.5 Q7.5 101.5 7.5 107.5 V126')
  })

  it('draws no bracket for blockers with no task after them', () => {
    expect(bracketPath([row(0), row(42, true)])).toBe('')
  })

  it('never goes left of the leftmost row', () => {
    // The held row stands right of the blocker: the line keeps to the leftmost row's edge.
    const d = bracketPath([row(0, false, 20), row(42, true, 14), row(84, false, 40)])
    expect(d.startsWith('M14 59.5 H')).toBe(true)
    const x = Number(/Q(\d+(?:\.\d+)?)/.exec(d)![1])
    expect(x).toBeGreaterThanOrEqual(14)
  })
})
