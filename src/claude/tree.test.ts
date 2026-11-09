import { describe, expect, it } from 'vitest'
import { descendantProcesses, descendants, descendantsOf, leftoversAfterStop, listFailure, parseProcessTable, sameProcess } from './tree.js'

const timedOut = Object.assign(new Error('Command failed: powershell.exe'), { killed: true, signal: 'SIGTERM', code: null })

describe('the leftovers of a stopped session', () => {
  const root = { pid: 10, startedAt: 2000 }
  const table: [number, number, number][] = [[10, 1, 1900], [11, 10, 3000], [12, 11, 3100]]

  it('takes the descendants from the listing alongside the stop when it worked', async () => {
    const lines: string[] = []
    const first = descendantsOf(root, (line) => lines.push(line), async () => table)
    const again = async () => { throw new Error('must not list again') }
    expect(await leftoversAfterStop(first, root, 'session-1', (line) => lines.push(line), true, again)).toEqual([
      { pid: 11, startedAt: 3000 }, { pid: 12, startedAt: 3100 },
    ])
    expect(lines).toEqual([])
  })

  it('lists again after the exit when the first listing failed, finding the orphans by their kept parent pid', async () => {
    const lines: string[] = []
    const log = (line: string) => lines.push(line)
    const first = descendantsOf(root, log, async () => { throw timedOut })
    const orphans = table.filter(([pid]) => pid !== 10)
    expect(await leftoversAfterStop(first, root, 'session-1', log, true, async () => orphans)).toEqual([
      { pid: 11, startedAt: 3000 }, { pid: 12, startedAt: 3100 },
    ])
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^sessions: listing the processes under pid 10 timed out after \d+ ms \(limit 15000 ms\)$/)
  })

  it('logs both failures and still finishes the stop with nothing to kill', async () => {
    const lines: string[] = []
    const log = (line: string) => lines.push(line)
    const first = descendantsOf(root, log, async () => { throw new Error('Access denied') })
    expect(await leftoversAfterStop(first, root, 'session-1', log, true, async () => { throw timedOut })).toEqual([])
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatch(/^sessions: listing the processes under pid 10 failed after \d+ ms: Access denied$/)
    expect(lines[1]).toMatch(/timed out/)
    expect(lines[2]).toBe('sessions: session-1 stopped, but its process tree could not be listed: background commands it started may still run and hold its folder')
  })

  it('does not list again where orphans lose their parent pid', async () => {
    const lines: string[] = []
    const log = (line: string) => lines.push(line)
    const first = descendantsOf(root, log, async () => { throw new Error('ps failed') })
    const again = async () => { throw new Error('must not list again') }
    expect(await leftoversAfterStop(first, root, 'session-1', log, false, again)).toEqual([])
    expect(lines).toHaveLength(2)
    expect(lines[1]).toMatch(/could not be listed/)
  })

  it('has nothing to list without the session pid', async () => {
    expect(await leftoversAfterStop(Promise.resolve([]), undefined, 'session-1', () => {}, true)).toEqual([])
  })

  it('names a timeout apart from other failures, with what the command printed', () => {
    expect(listFailure(timedOut, 120)).toBe('timed out after 120 ms (limit 15000 ms)')
    expect(listFailure(Object.assign(new Error('Command failed'), { code: 1, stderr: ' denied \r\n' }), 40)).toBe('failed after 40 ms: exit code 1 / denied')
    expect(listFailure('odd', 5)).toBe('failed after 5 ms: odd')
  })
})

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
