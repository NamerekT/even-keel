import { describe, expect, it } from 'vitest'
import { lineDiff } from './diff.js'

describe('lineDiff', () => {
  it('keeps two lines around a change and counts the stretches between', () => {
    const before = ['# Goal', 'a', 'b', 'c', 'd', 'e', 'f', 'Done when green.', 'g'].join('\n')
    const after = ['# Goal', 'a', 'b', 'c', 'd', 'e', 'f', 'Done when green, see the docs.', 'New line.', 'g'].join('\n')
    expect(lineDiff(before, after)).toEqual([
      { kind: 'skipped', lines: 5 },
      { kind: 'same', text: 'e' },
      { kind: 'same', text: 'f' },
      { kind: 'removed', text: 'Done when green.' },
      { kind: 'added', text: 'Done when green, see the docs.' },
      { kind: 'added', text: 'New line.' },
      { kind: 'same', text: 'g' },
    ])
  })

  it('counts a stretch between two changes only when it is longer than their context', () => {
    const before = ['x', '1', '2', '3', '4', '5', '6', 'y'].join('\n')
    const after = ['X', '1', '2', '3', '4', '5', '6', 'Y'].join('\n')
    expect(lineDiff(before, after).map((line) => (line.kind === 'skipped' ? `…${line.lines}` : `${line.kind[0]}${line.text}`))).toEqual([
      'rx', 'aX', 's1', 's2', '…2', 's5', 's6', 'ry', 'aY',
    ])
  })

  it('gives an empty text as no lines', () => {
    expect(lineDiff('', 'one\ntwo')).toEqual([{ kind: 'added', text: 'one' }, { kind: 'added', text: 'two' }])
    expect(lineDiff('one', '')).toEqual([{ kind: 'removed', text: 'one' }])
  })

  it('reads CRLF as LF, so a line ending alone is no change', () => {
    expect(lineDiff('a\r\nb', 'a\nb')).toEqual([])
  })

  it('compares texts too long to align as all lines removed and added', () => {
    const before = Array.from({ length: 3000 }, (_, index) => `old ${index}`).join('\n')
    const after = Array.from({ length: 3000 }, (_, index) => `new ${index}`).join('\n')
    const diff = lineDiff(before, after)
    expect(diff.filter((line) => line.kind === 'removed')).toHaveLength(3000)
    expect(diff.filter((line) => line.kind === 'added')).toHaveLength(3000)
  })
})
