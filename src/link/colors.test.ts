import { describe, expect, it } from 'vitest'
import { MACHINE_PALETTE, nextColor } from './colors.js'

describe('the colour a new machine is offered', () => {
  it('is the first of the palette no machine has', () => {
    expect(nextColor([])).toBe(MACHINE_PALETTE[0])
    expect(nextColor([MACHINE_PALETTE[0]!, MACHINE_PALETTE[2]!.toUpperCase()])).toBe(MACHINE_PALETTE[1])
  })

  it('goes round the palette once every colour is taken', () => {
    expect(nextColor([...MACHINE_PALETTE, '#123456'])).toBe(MACHINE_PALETTE[1])
  })
})
