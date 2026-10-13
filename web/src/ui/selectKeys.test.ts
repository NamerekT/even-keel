import { describe, expect, it } from 'vitest'
import { matchOf, stepOf } from './selectKeys.js'

describe('stepOf', () => {
  it('moves one option down and up, stopping at the ends', () => {
    expect(stepOf('ArrowDown', 0, 3)).toBe(1)
    expect(stepOf('ArrowDown', 2, 3)).toBe(2)
    expect(stepOf('ArrowUp', 1, 3)).toBe(0)
    expect(stepOf('ArrowUp', 0, 3)).toBe(0)
  })

  it('jumps to the first and the last option', () => {
    expect(stepOf('Home', 2, 3)).toBe(0)
    expect(stepOf('End', 0, 3)).toBe(2)
  })

  it('starts from the ends when nothing is active', () => {
    expect(stepOf('ArrowDown', -1, 3)).toBe(0)
    expect(stepOf('ArrowUp', -1, 3)).toBe(2)
  })

  it('leaves other keys alone', () => {
    expect(stepOf('Enter', 1, 3)).toBeUndefined()
    expect(stepOf('a', 1, 3)).toBeUndefined()
  })
})

describe('matchOf', () => {
  const labels = ['sonnet', 'opus', 'haiku', 'Sonnet 4']

  it('finds the first label the typed text starts, ignoring case', () => {
    expect(matchOf(labels, 'o', 0)).toBe(1)
    expect(matchOf(labels, 'H', 0)).toBe(2)
  })

  it('keeps the active option while the typed text still fits it', () => {
    expect(matchOf(labels, 'so', 0)).toBe(0)
    expect(matchOf(labels, 'sonnet ', 0)).toBe(3)
  })

  it('cycles through the options of one repeated letter', () => {
    expect(matchOf(labels, 's', 0)).toBe(3)
    expect(matchOf(labels, 'ss', 3)).toBe(0)
  })

  it('wraps around past the last option', () => {
    expect(matchOf(labels, 'o', 3)).toBe(1)
  })

  it('gives -1 when no label fits', () => {
    expect(matchOf(labels, 'x', 0)).toBe(-1)
  })
})
