import { describe, expect, it } from 'vitest'
import { typedAt } from './typing.js'

const pace = { charMs: 10, pauseMs: 100 }

describe('typedAt', () => {
  it('types the first part a character per step', () => {
    expect(typedAt(['abc', 'de'], 0, pace)).toBe(0)
    expect(typedAt(['abc', 'de'], 25, pace)).toBe(2)
  })

  it('holds at the end of a part for the pause, then goes on', () => {
    expect(typedAt(['abc', 'de'], 30, pace)).toBe(3)
    expect(typedAt(['abc', 'de'], 129, pace)).toBe(3)
    expect(typedAt(['abc', 'de'], 140, pace)).toBe(4)
  })

  it('pauses between every two parts and stops at the whole text', () => {
    expect(typedAt(['a', 'b', 'c'], 10 + 100 + 10 + 50, pace)).toBe(2)
    expect(typedAt(['a', 'b', 'c'], 10_000, pace)).toBe(3)
  })
})
