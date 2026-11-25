import { describe, expect, it } from 'vitest'
import { MACHINE_PALETTE } from '../../src/link/colors.js'
import { contrast, DARK_INK, inkOn, LIGHT_INK, machineGlyph, machineLook, machineWords } from './machineIcon.js'

describe('the sign of a machine icon', () => {
  it('is the system the machine runs', () => {
    expect(machineGlyph('win32')).toBe('windows')
    expect(machineGlyph('darwin')).toBe('macos')
    expect(machineGlyph('linux')).toBe('linux')
  })

  it('is none for a system it does not know or a machine that told nothing', () => {
    expect(machineGlyph('freebsd')).toBeNull()
    expect(machineGlyph(undefined)).toBeNull()
  })
})

describe('the look of a machine icon', () => {
  const state = {
    ownMachine: 'pc',
    machineKinds: { pc: { platform: 'linux' }, box: { platform: 'linux', container: true as const }, mac: { platform: 'darwin' } },
  }

  it('is a hub for the own machine and a machine for the others', () => {
    expect(machineLook(state, 'pc')).toEqual({ hub: true, glyph: 'linux', docker: false })
    expect(machineLook(state, 'mac')).toEqual({ hub: false, glyph: 'macos', docker: false })
  })

  it('has the container frame where Even Keel runs in Docker', () => {
    expect(machineLook(state, 'box')).toEqual({ hub: false, glyph: 'linux', docker: true })
  })

  it('is a bare machine shape for a machine not told about, or an older service', () => {
    expect(machineLook(state, 'gone')).toEqual({ hub: false, glyph: null, docker: false })
    expect(machineLook(null, 'pc')).toEqual({ hub: false, glyph: null, docker: false })
  })

  it('says itself in words for the tip', () => {
    expect(machineWords({ hub: true, glyph: 'linux', docker: true })).toBe('Hub, Linux, in Docker')
    expect(machineWords({ hub: false, glyph: 'windows', docker: false })).toBe('Machine, Windows')
    expect(machineWords({ hub: false, glyph: null, docker: false })).toBe('Machine')
  })
})

describe('the ink of the sign', () => {
  it('is dark on a light colour and light on a dark one', () => {
    expect(inkOn('#f4f4f0')).toBe(DARK_INK)
    expect(inkOn('#ffffff')).toBe(DARK_INK)
    expect(inkOn('#1a2a5a')).toBe(LIGHT_INK)
    expect(inkOn('#050505')).toBe(LIGHT_INK)
  })

  it('reads on every colour of the palette', () => {
    for (const color of MACHINE_PALETTE) expect(contrast(color, inkOn(color)!)).toBeGreaterThanOrEqual(4.5)
  })

  it('is no choice for a colour that is not #rrggbb', () => {
    expect(inkOn('var(--series-other)')).toBeUndefined()
  })
})
