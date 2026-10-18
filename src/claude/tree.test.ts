import { describe, expect, it } from 'vitest'
import { descendants, parseProcessTable } from './tree.js'

describe('the process tree of a session', () => {
  it('reads pid and parent pid pairs, skipping lines that are not two numbers', () => {
    expect(parseProcessTable('  4 0\r\n32224 32108\n\nheader line\n36784 32224 \n')).toEqual([
      [4, 0],
      [32224, 32108],
      [36784, 32224],
    ])
  })

  it('takes every process under the root, deepest last, and nothing beside it', () => {
    const table: [number, number][] = [
      [14328, 1],
      [32108, 14328],
      [32224, 32108],
      [36784, 32224],
      [31748, 36784],
      [7664, 31748],
      [500, 14328],
      [501, 500],
    ]
    expect(descendants(table, 32224)).toEqual([36784, 31748, 7664])
  })

  it('stops on a loop in the table and has nothing for a leaf', () => {
    expect(descendants([[2, 3], [3, 2]], 2)).toEqual([3])
    expect(descendants([[7, 1]], 7)).toEqual([])
  })
})
