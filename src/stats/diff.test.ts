import { describe, expect, it } from 'vitest'
import { lineDiff } from './diff.js'

const lines = (...items: string[]) => items.join('\n')

describe('lineDiff', () => {
  it('counts nothing for equal texts', () => {
    const diff = lineDiff('a\nb', 'a\nb')
    expect(diff).toEqual({ added: 0, removed: 0, hunks: [] })
  })

  it('counts added and removed lines', () => {
    const diff = lineDiff(lines('a', 'b', 'c'), lines('a', 'x', 'c', 'd'))
    expect(diff.added).toBe(2)
    expect(diff.removed).toBe(1)
  })

  it('treats a missing old text as all added', () => {
    expect(lineDiff(null, 'a\nb')).toMatchObject({ added: 2, removed: 0 })
    expect(lineDiff('a\nb', null)).toMatchObject({ added: 0, removed: 2 })
    expect(lineDiff('', 'a')).toMatchObject({ added: 1, removed: 0 })
  })

  it('keeps three lines of context and splits far changes into hunks', () => {
    const old = Array.from({ length: 20 }, (_, index) => `l${index}`)
    const next = [...old]
    next[2] = 'changed'
    next[17] = 'changed too'
    const diff = lineDiff(old.join('\n'), next.join('\n'))
    expect(diff.hunks).toHaveLength(2)
    expect(diff.hunks[0]).toEqual({
      oldStart: 1,
      newStart: 1,
      lines: [' l0', ' l1', '-l2', '+changed', ' l3', ' l4', ' l5'],
    })
    expect(diff.hunks[1]!.oldStart).toBe(15)
    expect(diff.hunks[1]!.lines.at(-1)).toBe(' l19')
  })

  it('merges changes whose context overlaps into one hunk', () => {
    const old = Array.from({ length: 12 }, (_, index) => `l${index}`)
    const next = [...old]
    next[2] = 'x'
    next[7] = 'y'
    expect(lineDiff(old.join('\n'), next.join('\n')).hunks).toHaveLength(1)
  })
})
