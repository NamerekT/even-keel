import { describe, expect, it } from 'vitest'
import { MACHINE_PALETTE } from '../../src/link/colors.js'
import { machinePath, nearAccountColor } from './machineColor.js'

const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#84cc52', '#9085e9', '#ff9b9b']

describe("a machine's colour (BTN-1272)", () => {
  it('warns only of a colour close to an account colour', () => {
    expect(nearAccountColor('#3a88e0', SERIES)).toBe(true)
    expect(nearAccountColor('#6f8f7f', SERIES)).toBe(false)
    expect(nearAccountColor('teal', SERIES)).toBe(false)
  })

  it('keeps the default palette away from the account colours of both themes', () => {
    const light = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#a51d2d']
    for (const color of MACHINE_PALETTE) {
      expect(nearAccountColor(color, [...SERIES, ...light]), color).toBe(false)
    }
  })

  it('addresses the page of a machine by its id', () => {
    expect(machinePath('a b')).toBe('/machines/a%20b')
  })
})
