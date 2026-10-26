import { describe, expect, it } from 'vitest'
import { descendantProcesses, descendants, parseProcessTable, sameProcess } from './tree.js'

describe('the process tree of a session', () => {
  it('reads optional creation times without losing unknown ones', () => {
    expect(parseProcessTable('4 0 1000\n5 4\n6 4 2000\n')).toEqual([[4, 0, 1000], [5, 4], [6, 4, 2000]])
  })

  it('rejects a reused root and stale parent links, retaining only its current children', () => {
    const table: [number, number, number][] = [[10, 1, 2000], [11, 10, 1000], [12, 11, 3000], [13, 10, 2500], [14, 13, 2600]]
    expect(descendantProcesses(table, { pid: 10, startedAt: 1500 })).toEqual([])
    expect(descendantProcesses(table, { pid: 10, startedAt: 2100 })).toEqual([{ pid: 13, startedAt: 2500 }, { pid: 14, startedAt: 2600 }])
  })

  it('keeps orphan descendants after the root exits and preserves unknown times', () => {
    expect(descendantProcesses([[11, 10, 3000], [12, 11], [13, 10, 1000]], { pid: 10, startedAt: 2000 })).toEqual([
      { pid: 11, startedAt: 3000 }, { pid: 12 },
    ])
    expect(descendantProcesses([[11, 10]], { pid: 10 })).toEqual([{ pid: 11 }])
  })

  it('does not kill a saved child whose pid now belongs to another process', () => {
    expect(sameProcess({ pid: 10, startedAt: 2000 }, 3000)).toBe(false)
    expect(sameProcess({ pid: 10, startedAt: 2000 }, 1000)).toBe(false)
    expect(sameProcess({ pid: 10, startedAt: 2000 }, 2000)).toBe(true)
    expect(sameProcess({ pid: 10, startedAt: 2000 }, undefined)).toBe(true)
    expect(sameProcess({ pid: 10 }, 3000)).toBe(true)
  })

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
