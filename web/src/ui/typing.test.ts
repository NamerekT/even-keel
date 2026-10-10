import { describe, expect, it } from 'vitest'
import { book, shownAt, typedAt, typingTime } from './typing.js'

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

describe('shownAt', () => {
  it('types as usual while the line is not being erased', () => {
    expect(shownAt(['abc', 'de'], 140, pace, null)).toBe(4)
    expect(shownAt(['abc', 'de'], 140, pace, 500)).toBe(4)
  })

  it('erases at the typing pace from what was shown when erasing began', () => {
    expect(shownAt(['abc', 'de'], 500, pace, 500)).toBe(5)
    expect(shownAt(['abc', 'de'], 525, pace, 500)).toBe(3)
    expect(shownAt(['abc', 'de'], 140 + 10, pace, 140)).toBe(3)
  })

  it('stops at an empty line', () => {
    expect(shownAt(['abc', 'de'], 10_000, pace, 500)).toBe(0)
  })
})

describe('typingTime', () => {
  it('sums the characters and the holds between parts', () => {
    expect(typingTime(['abc', 'de', 'f'], pace)).toBe(60 + 200)
    expect(typingTime(['abc'], pace)).toBe(30)
  })
})

describe('book', () => {
  it('runs lines one after another with a single typist', () => {
    const free = [0]
    expect(book(free, 0, 50)).toBe(0)
    expect(book(free, 10, 30)).toBe(50)
    expect(free).toEqual([80])
  })

  it('gives each line the typist that frees first, and never starts in the past', () => {
    const free = [0, 0]
    expect(book(free, 0, 50)).toBe(0)
    expect(book(free, 0, 20)).toBe(0)
    expect(book(free, 5, 10)).toBe(20)
    expect(book(free, 100, 10)).toBe(100)
  })
})
