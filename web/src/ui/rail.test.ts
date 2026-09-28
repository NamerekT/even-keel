import { describe, expect, it } from 'vitest'
import { railLanes, railPath } from './rail.js'

describe('railLanes', () => {
  it('draws the links of one blocker on one lane', () => {
    expect(
      railLanes([
        { from: 0, to: 1 },
        { from: 0, to: 3 },
      ]),
    ).toEqual([{ from: 0, to: [1, 3], lane: 0 }])
  })

  it('puts overlapping blockers on separate lanes and reuses a lane once it is free', () => {
    expect(
      railLanes([
        { from: 2, to: 5 },
        { from: 0, to: 3 },
        { from: 1, to: 2 },
        { from: 4, to: 6 },
      ]),
    ).toEqual([
      { from: 0, to: [3], lane: 0 },
      { from: 1, to: [2], lane: 1 },
      { from: 2, to: [5], lane: 2 },
      { from: 4, to: [6], lane: 0 },
    ])
  })

  it('does not share a lane between a link ending on a row and one starting on it', () => {
    expect(
      railLanes([
        { from: 0, to: 1 },
        { from: 1, to: 2 },
      ]).map((link) => link.lane),
    ).toEqual([0, 1])
  })
})

describe('railPath', () => {
  it('leaves the blocker to the lane, runs down it and comes back into the dependent', () => {
    expect(railPath({ x: 40, y: 20 }, { x: 40, y: 140 }, 28)).toBe('M 40 20 H 28 V 140 H 40')
  })
})
