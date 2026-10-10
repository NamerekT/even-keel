import { describe, expect, it } from 'vitest'
import { BOAT_MAST, boatSketch, crestAt, poseAt, voyageFrame } from './voyage.js'

const rows = (frame: string) => frame.split('\n')
const mastTop = (frame: string) => rows(frame).findIndex((row) => row.includes('|'))
const tickWhere = (test: (crest: number) => boolean) => {
  let tick = 0
  while (!test(crestAt(tick))) tick++
  return tick
}
/** How far the mast's top stands right of its foot, in columns. */
const mastLean = (sketch: string[]) => sketch[0]!.indexOf('|') - sketch.at(-3)!.indexOf('|')

describe('voyageFrame', () => {
  it('keeps the same size on every tick, sailing or driving', () => {
    const sizes = new Set(
      [0, 17, 60, 133, 400].flatMap((tick) => [false, true].map((drive) => rows(voyageFrame(tick, drive)).map((row) => row.length).join(','))),
    )
    expect(sizes.size).toBe(1)
  })

  it('lifts the boat when the swell crest passes under the mast', () => {
    const crest = tickWhere((at) => Math.abs(at - BOAT_MAST) <= 0.3)
    expect(mastTop(voyageFrame(crest))).toBeLessThan(mastTop(voyageFrame(0)) - 1)
    expect(mastTop(voyageFrame(crest, true))).toBeLessThan(mastTop(voyageFrame(0, true)))
  })

  it('puts the driving boat on two wheels right under its hull, and the sailing one on none', () => {
    for (const tick of [0, tickWhere((at) => Math.abs(at - BOAT_MAST) <= 0.3)]) {
      const frame = rows(voyageFrame(tick, true))
      const keel = frame.findIndex((row) => row.includes('\\_________________/'))
      expect(frame[keel + 1]!.match(/\(o\)/g)).toHaveLength(2)
    }
    expect(voyageFrame(0)).not.toContain('(o)')
  })
})

describe('poseAt', () => {
  it('rides the crest level and high', () => {
    const pose = poseAt(tickWhere((at) => Math.abs(at - BOAT_MAST) <= 0.3))
    expect(pose.lift).toBeGreaterThan(1.5)
    expect(Math.abs(pose.tilt)).toBeLessThan(0.02)
  })

  it('raises the bow while climbing and drops it while coming down', () => {
    expect(poseAt(tickWhere((at) => at < BOAT_MAST + 10)).tilt).toBeGreaterThan(0.05)
    expect(poseAt(tickWhere((at) => at < BOAT_MAST - 10)).tilt).toBeLessThan(-0.05)
  })

  it('settles once the swell has passed', () => {
    expect(poseAt(tickWhere((at) => at < BOAT_MAST - 40))).toEqual({ lift: 0, tilt: 0 })
  })
})

describe('boatSketch', () => {
  it('draws the level boat as the hand-drawn one', () => {
    expect(boatSketch(0)).toEqual([
      '          |\\',
      '          | \\',
      '          |  \\',
      '         /|   \\',
      '        / |    \\',
      '       /  |     \\',
      '      /___|______\\',
      '__________|__________',
      '\\    o    o    o    /',
      ' \\_________________/',
    ])
  })

  it('leans the mast back with the bow up and forward with the bow down, the hull staying level', () => {
    const level = boatSketch(0)
    const hull = level.slice(-3)
    expect(mastLean(boatSketch(0.15))).toBeLessThan(0)
    expect(mastLean(boatSketch(-0.15))).toBeGreaterThan(0)
    expect(boatSketch(0.15).slice(-3)).toEqual(hull)
    expect(boatSketch(-0.15).slice(-3)).toEqual(hull)
  })
})
