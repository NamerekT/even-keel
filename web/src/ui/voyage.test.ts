import { describe, expect, it } from 'vitest'
import { BOAT_MAST, crestAt, voyageFrame } from './voyage.js'

const rows = (frame: string) => frame.split('\n')
const mastTop = (frame: string) => rows(frame).findIndex((row) => row[BOAT_MAST] === '|')

describe('voyageFrame', () => {
  it('keeps the same size on every tick', () => {
    const sizes = new Set([0, 17, 60, 133, 400].map((tick) => rows(voyageFrame(tick)).map((row) => row.length).join(',')))
    expect(sizes.size).toBe(1)
  })

  it('lifts the boat when the swell crest passes under the mast', () => {
    const calm = 0
    let crest = 0
    while (Math.abs(crestAt(crest) - BOAT_MAST) > 0.3) crest++
    expect(mastTop(voyageFrame(crest))).toBeLessThan(mastTop(voyageFrame(calm)))
  })

  it('brings the boat back down once the swell has passed', () => {
    let after = 0
    while (crestAt(after) > BOAT_MAST - 20) after++
    expect(mastTop(voyageFrame(after))).toBe(mastTop(voyageFrame(0)))
  })
})
