import { describe, expect, it } from 'vitest'
import { clampDrop, clampShift, dropBounds, nearestIndex, relatives, stackedTops } from './reorder.js'

const blockers = new Map<string, string[]>([
  ['A', []],
  ['B', []],
  ['C', ['A']],
  ['D', []],
  ['E', ['C', 'B']],
])
const order = ['A', 'B', 'C', 'D', 'E']

describe('dropBounds', () => {
  it('stops a task right after its last blocker and right before its first dependent', () => {
    expect(dropBounds(order, blockers, 2, 0)).toEqual({ min: 1, max: 3 })
  })

  it('lets a task without links go anywhere below the pinned head', () => {
    expect(dropBounds(order, blockers, 3, 1)).toEqual({ min: 1, max: 4 })
  })

  it('keeps a blocker above its first dependent', () => {
    expect(dropBounds(order, blockers, 0, 0)).toEqual({ min: 0, max: 1 })
    expect(dropBounds(order, blockers, 1, 0)).toEqual({ min: 0, max: 3 })
  })

  it('takes the last of several blockers', () => {
    expect(dropBounds(order, blockers, 4, 0)).toEqual({ min: 3, max: 4 })
  })

  it('ignores blockers outside the order', () => {
    expect(dropBounds(['X', 'Y'], new Map([['Y', ['Q']]]), 1, 0)).toEqual({ min: 0, max: 1 })
  })
})

describe('clampDrop', () => {
  it('pulls the target inside the bounds', () => {
    expect(clampDrop({ min: 1, max: 3 }, 0, 2)).toBe(1)
    expect(clampDrop({ min: 1, max: 3 }, 4, 2)).toBe(3)
    expect(clampDrop({ min: 1, max: 3 }, 2, 2)).toBe(2)
  })

  it('stays in place when the bounds contradict each other', () => {
    expect(clampDrop({ min: 3, max: 1 }, 0, 2)).toBe(2)
  })
})

describe('relatives', () => {
  it('names the blockers and the dependents of a task within the order', () => {
    expect(relatives(order, blockers, 'C')).toEqual({ blockers: ['A'], dependents: ['E'] })
    expect(relatives(['C', 'E'], blockers, 'C')).toEqual({ blockers: [], dependents: ['E'] })
  })
})

describe('nearestIndex', () => {
  it('picks the closest centre in both directions', () => {
    const centers = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]
    expect(nearestIndex(centers, { x: 90, y: 30 })).toBe(1)
    expect(nearestIndex(centers, { x: 70, y: 80 })).toBe(2)
    expect(nearestIndex(centers, { x: -50, y: 10 })).toBe(0)
  })
})

describe('clampShift', () => {
  const box = { left: 10, top: 100, width: 200, height: 40 }
  const area = { width: 300, height: 400 }

  it('keeps a shift that stays inside the list', () => {
    expect(clampShift(box, area, { x: 20, y: -60 })).toEqual({ x: 20, y: -60 })
  })

  it('stops the card at the edges of the list', () => {
    expect(clampShift(box, area, { x: 500, y: 900 })).toEqual({ x: 90, y: 260 })
    expect(clampShift(box, area, { x: -500, y: -900 })).toEqual({ x: -10, y: -100 })
  })
})

describe('stackedTops', () => {
  const box = (top: number, height: number) => ({ left: 0, top, width: 100, height })

  it('keeps the tops when the order stays', () => {
    const boxes = [box(0, 70), box(78, 34), box(120, 34)]
    expect(stackedTops(boxes, [0, 1, 2])).toEqual([0, 78, 120])
  })

  it('stacks cards of different heights without holes or overlaps', () => {
    const boxes = [box(0, 70), box(78, 34), box(120, 34)]
    expect(stackedTops(boxes, [1, 0, 2])).toEqual([42, 0, 120])
  })

  it('keeps a milestone divider between the same places', () => {
    const boxes = [box(0, 70), box(78, 70), box(190, 34)]
    expect(stackedTops(boxes, [0, 2, 1])).toEqual([0, 154, 78])
  })
})
