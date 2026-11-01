import { describe, expect, it } from 'vitest'
import { briefBack } from './TrackerFixButtons.js'

describe('briefBack', () => {
  it('leaves the description to auto, which gives it without the package, unless auto would inherit a shared off', () => {
    expect(briefBack(null)).toBeNull()
    expect(briefBack(true)).toBeNull()
    expect(briefBack(false)).toBe(true)
  })
})
