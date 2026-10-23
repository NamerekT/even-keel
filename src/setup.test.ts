import { describe, expect, it } from 'vitest'
import { firstRun } from './setup.js'

describe('firstRun', () => {
  it('lasts while the stats are not chosen and no project is added', () => {
    expect(firstRun(null, 0)).toBe(true)
    expect(firstRun('off', 0)).toBe(false)
    expect(firstRun(null, 1)).toBe(false)
  })
})
