import { describe, expect, it } from 'vitest'
import { conflictLines, readConflict } from './conflict.js'

describe('conflictLines', () => {
  it('counts the lines inside the conflict blocks, the marker lines left out', () => {
    const text = [
      'before',
      '<<<<<<< HEAD',
      'ours 1',
      'ours 2',
      '=======',
      'theirs 1',
      '>>>>>>> refs/even-keel/forward/EKR',
      'between',
      '<<<<<<< HEAD',
      'ours',
      '||||||| base',
      'base',
      '=======',
      '>>>>>>> refs/even-keel/forward/EKR',
      'after',
    ].join('\n')
    expect(conflictLines(text)).toBe(5)
  })

  it('reads CRLF files and counts nothing outside a block', () => {
    expect(conflictLines('a\r\n<<<<<<< HEAD\r\nx\r\n=======\r\ny\r\n>>>>>>> them\r\n=======\r\n')).toBe(2)
    expect(conflictLines('no markers here\n')).toBe(0)
  })
})

describe('readConflict', () => {
  it('gives each conflicted file its lines and marks one deleted on one side', async () => {
    const unmerged = [
      '100644 aaa 1\tsrc/a.ts',
      '100644 bbb 2\tsrc/a.ts',
      '100644 ccc 3\tsrc/a.ts',
      '100644 ddd 1\tsrc/gone.ts',
      '100644 eee 3\tsrc/gone.ts',
    ].join('\0')
    const calls: string[] = []
    const conflict = await readConflict(
      async (_cwd, args) => {
        calls.push(args.join(' '))
        return { code: 0, out: `${unmerged}\0` }
      },
      '/home/john/even-keel',
      ['src/a.ts', 'src/gone.ts'],
      async (path) => (path === 'src/a.ts' ? '<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> them\n' : null),
    )
    expect(calls).toEqual(['ls-files --unmerged -z'])
    expect(conflict).toEqual([
      { path: 'src/a.ts', lines: 2 },
      { path: 'src/gone.ts', lines: null },
    ])
  })

  it('counts nothing for a file it cannot read', async () => {
    const out = ['100644 a 1\tx.ts', '100644 b 2\tx.ts', '100644 c 3\tx.ts', ''].join('\0')
    const conflict = await readConflict(async () => ({ code: 0, out }), '/r', ['x.ts'], async () => null)
    expect(conflict).toEqual([{ path: 'x.ts', lines: 0 }])
  })
})
