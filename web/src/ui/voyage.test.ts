import { describe, expect, it } from 'vitest'
import { boatSketch, crestAt, mastAt, poseAt, seaAt, SKY_ROWS, VOYAGE_WIDTH, voyageFrame } from './voyage.js'

const rows = (frame: string) => frame.split('\n')
const mastTop = (frame: string) => rows(frame).findIndex((row) => row.includes('|'))
const tickWhere = (test: (crest: number) => boolean) => {
  let tick = 0
  while (!test(crestAt(tick))) tick++
  return tick
}
/** The tick of the first 200 at which `value` is the largest. */
const mostAt = (value: (tick: number) => number) =>
  Array.from({ length: 200 }, (_, tick) => tick).reduce((best, tick) => (value(tick) > value(best) ? tick : best))
const crestTick = mostAt((tick) => seaAt(mastAt(), tick))
const troughTick = mostAt((tick) => -seaAt(mastAt(), tick))
const KEEL = '\\_____________________/'
/** How far the mast's top stands right of its foot, in columns. */
const mastLean = (sketch: string[]) => sketch[0]!.indexOf('|') - sketch.at(-5)!.indexOf('|')

describe('voyageFrame', () => {
  it('keeps the same size on every tick, sailing or driving', () => {
    const sizes = new Set(
      [0, 17, 60, 133, 400].flatMap((tick) => [false, true].map((drive) => rows(voyageFrame(tick, drive)).map((row) => row.length).join(','))),
    )
    expect(sizes.size).toBe(1)
  })

  it('stretches the sea and the sky to the width asked, the boat keeping its size, but not below the narrowest', () => {
    for (const width of [80, 130]) {
      const frame = rows(voyageFrame(0, false, 0, width))
      expect(new Set(frame.map((row) => row.length))).toEqual(new Set([width]))
      expect(frame.join('\n')).toContain('_____________|_____________')
    }
    expect(rows(voyageFrame(0, false, 0, 10))[0]).toHaveLength(VOYAGE_WIDTH.min)
  })

  it('lifts the sailing boat on a crest and lowers it in a trough', () => {
    expect(mastTop(voyageFrame(crestTick))).toBeLessThan(mastTop(voyageFrame(troughTick)))
  })

  it('brings the water up to the bottom of the hull, so the boat never hangs over a trough', () => {
    for (let tick = 0; tick < 150; tick += 3) {
      const frame = rows(voyageFrame(tick))
      const deck = frame.findIndex((row) => row.includes('_____________|_____________'))
      const stern = frame[deck]!.indexOf('_____________|')
      const under = frame.slice(deck + 4).map((row) => row.slice(stern + 3, stern + 24))
      expect(under.join('')).not.toMatch(/['_-]/)
    }
  })

  it('lifts the driving boat when the hill passes under the mast', () => {
    const crest = tickWhere((at) => Math.abs(at - mastAt()) <= 0.3)
    expect(mastTop(voyageFrame(crest, true))).toBeLessThan(mastTop(voyageFrame(0, true)))
  })

  it('draws the water at its height inside a row, rising and falling', () => {
    const seas = Array.from({ length: 40 }, (_, tick) => rows(voyageFrame(tick)).slice(SKY_ROWS).join('\n'))
    expect(seas.some((sea) => /[_.]-+'/.test(sea))).toBe(true)
    expect(seas.some((sea) => /'-+[._]/.test(sea))).toBe(true)
  })

  it('puts the driving boat on two wheels right under its hull, and the sailing one on none', () => {
    for (const tick of [0, tickWhere((at) => Math.abs(at - mastAt()) <= 0.3)]) {
      const frame = rows(voyageFrame(tick, true))
      const keel = frame.findIndex((row) => row.includes(KEEL))
      expect(frame[keel + 1]!.match(/\(o\)/g)).toHaveLength(2)
    }
    expect(voyageFrame(0)).not.toContain('(o)')
  })

  it('draws ticks before zero, so the voyage can run backwards', () => {
    for (const tick of [-1, -17, -400]) {
      for (const drive of [false, true]) {
        const frame = voyageFrame(tick, drive)
        expect(frame).not.toContain('undefined')
        expect(rows(frame).map((row) => row.length)).toEqual(rows(voyageFrame(0, drive)).map((row) => row.length))
      }
    }
  })

  it('moves the sky on its own tick and leaves the sea and the boat alone', () => {
    const still = rows(voyageFrame(30, false, 30))
    const drifted = rows(voyageFrame(30, false, 80))
    expect(drifted.slice(0, SKY_ROWS)).not.toEqual(still.slice(0, SKY_ROWS))
    expect(drifted.slice(SKY_ROWS)).toEqual(still.slice(SKY_ROWS))
  })
})

describe('seaAt', () => {
  it('dips below the calm level as well as rises over it, with a sharper crest than trough', () => {
    const heights = Array.from({ length: 100 }, (_, column) => seaAt(column, 0))
    const crest = Math.max(...heights)
    const trough = Math.min(...heights)
    expect(crest).toBeGreaterThan(0.5)
    expect(trough).toBeLessThan(-0.5)
    expect(crest).toBeGreaterThan(-trough)
  })
})

describe('poseAt', () => {
  it('rides the crest level and higher than the trough by more than a row', () => {
    expect(Math.abs(poseAt(crestTick).tilt)).toBeLessThan(0.02)
    expect(poseAt(crestTick).lift - poseAt(troughTick).lift).toBeGreaterThan(1)
  })

  it('raises the bow while the water under it stands higher than under the stern, and drops it the other way', () => {
    const climb = (tick: number) => seaAt(mastAt() + 10, tick) - seaAt(mastAt() - 10, tick)
    expect(poseAt(mostAt(climb)).tilt).toBeGreaterThan(0.05)
    expect(poseAt(mostAt((tick) => -climb(tick))).tilt).toBeLessThan(-0.05)
  })
})

describe('boatSketch', () => {
  it('draws the level boat as the hand-drawn one', () => {
    expect(boatSketch(0)).toEqual([
      '             |~>',
      '             |\\',
      '             | \\',
      '             |  \\',
      '            /|   \\',
      '           / |    \\',
      '           / |     \\',
      '          /  |      \\',
      '         /   |       \\',
      '         /   |        \\',
      '        /____|_________\\',
      '_____________|_____________',
      '\\  o    o    o    o    o  /',
      ' \\=======================/',
      '  \\_____________________/',
    ])
  })

  it('leans the mast back with the bow up and forward with the bow down, the hull and the boom staying level', () => {
    const level = boatSketch(0)
    const hull = level.slice(-5)
    expect(mastLean(boatSketch(0.12))).toBeLessThan(0)
    expect(mastLean(boatSketch(-0.12))).toBeGreaterThan(0)
    expect(boatSketch(0.12).slice(-5)).toEqual(hull)
    expect(boatSketch(-0.12).slice(-5)).toEqual(hull)
  })
})
