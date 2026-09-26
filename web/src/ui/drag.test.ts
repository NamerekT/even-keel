import { describe, expect, it } from 'vitest'
import { dragShift, dropIndex, moveItem } from './drag.js'

describe('moveItem', () => {
  it('moves an item down and up', () => {
    expect(moveItem(['A', 'B', 'C', 'D'], 0, 2)).toEqual(['B', 'C', 'A', 'D'])
    expect(moveItem(['A', 'B', 'C', 'D'], 3, 1)).toEqual(['A', 'D', 'B', 'C'])
  })

  it('returns an equal copy when the item stays in place', () => {
    const list = ['A', 'B']
    const moved = moveItem(list, 1, 1)
    expect(moved).toEqual(list)
    expect(moved).not.toBe(list)
  })

  it('clamps a target outside the list', () => {
    expect(moveItem(['A', 'B', 'C'], 0, 9)).toEqual(['B', 'C', 'A'])
    expect(moveItem(['A', 'B', 'C'], 2, -1)).toEqual(['C', 'A', 'B'])
  })
})

describe('dropIndex', () => {
  const mids = [20, 60, 100, 140]

  it('keeps the place while the dragged center is closest to it', () => {
    expect(dropIndex(mids, 60)).toBe(1)
    expect(dropIndex(mids, 79)).toBe(1)
    expect(dropIndex(mids, 41)).toBe(1)
  })

  it('takes the place whose center is closest, clamped to the ends', () => {
    expect(dropIndex(mids, 81)).toBe(2)
    expect(dropIndex(mids, 39)).toBe(0)
    expect(dropIndex(mids, 500)).toBe(3)
    expect(dropIndex(mids, -50)).toBe(0)
  })
})

describe('dragShift', () => {
  it('moves the rows between the old and new place one step towards the gap', () => {
    expect([0, 1, 2, 3].map((index) => dragShift(index, 0, 2, 40))).toEqual([0, -40, -40, 0])
    expect([0, 1, 2, 3].map((index) => dragShift(index, 3, 1, 40))).toEqual([0, 40, 40, 0])
  })

  it('leaves every row alone while the dragged one keeps its place', () => {
    expect([0, 1, 2].map((index) => dragShift(index, 1, 1, 40))).toEqual([0, 0, 0])
  })
})
