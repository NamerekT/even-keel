import { describe, expect, it, vi } from 'vitest'
import { PassMemo } from './pass-memo.js'

describe('PassMemo', () => {
  it('computes each key once inside a pass and anew outside it', () => {
    const memo = new PassMemo()
    const compute = vi.fn((key: string) => ({ key }))
    const read = memo.run(() => {
      const first = memo.of('a', () => compute('a'))
      expect(memo.of('a', () => compute('a'))).toBe(first)
      expect(memo.run(() => memo.of('a', () => compute('a')))).toBe(first)
      memo.of('b', () => compute('b'))
      return first
    })
    expect(compute).toHaveBeenCalledTimes(2)

    expect(memo.of('a', () => compute('a'))).not.toBe(read)
    expect(memo.of('a', () => compute('a'))).not.toBe(read)
    expect(compute).toHaveBeenCalledTimes(4)
  })

  it('keeps an undefined answer too', () => {
    const memo = new PassMemo()
    const compute = vi.fn(() => undefined)
    memo.run(() => {
      memo.of('a', compute)
      memo.of('a', compute)
    })
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('forgets the pass when its body throws', () => {
    const memo = new PassMemo()
    expect(() => memo.run(() => {
      memo.of('a', () => 1)
      throw new Error('failed')
    })).toThrow('failed')
    const compute = vi.fn(() => 2)
    memo.of('a', compute)
    memo.of('a', compute)
    expect(compute).toHaveBeenCalledTimes(2)
  })
})
