import { describe, expect, it } from 'vitest'
import { cappedWidth, widthMaxOf } from './poolWidth.js'

describe("the width field within the project's machines (BTN-1571)", () => {
  const machine = (enabled: boolean) => ({ enabled })

  it('takes every machine of the list as the most, turned on or off, and 1 for a project with none', () => {
    expect(widthMaxOf(null)).toBeUndefined()
    expect(widthMaxOf({ machines: [] })).toBe(1)
    expect(widthMaxOf({ machines: [machine(true), machine(false)] })).toBe(2)
    expect(widthMaxOf({ machines: [machine(true), machine(false), machine(false)] })).toBe(3)
  })

  it('keeps 2 of two machines and turns a 3 typed into 2', () => {
    expect(cappedWidth('2', 2)).toBe('2')
    expect(cappedWidth('3', 2)).toBe('2')
    expect(cappedWidth('12', 3)).toBe('3')
  })

  it('leaves what is not a whole number, and anything while the machines are read, for the field to mark', () => {
    expect(cappedWidth('', 2)).toBe('')
    expect(cappedWidth('x', 2)).toBe('x')
    expect(cappedWidth('5', undefined)).toBe('5')
  })
})
