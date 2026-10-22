import { describe, expect, it } from 'vitest'
import { shareOf } from './share.js'
import { checkoutOf, sharedFile } from './shareFile.js'

const WORKTREE = 'D:\\Projects\\repo\\.claude\\worktrees\\abc-12'

describe('checkoutOf', () => {
  it('is the main checkout of a task worktree or a slot, from any folder inside it', () => {
    expect(checkoutOf(WORKTREE, 'win32')).toBe('D:\\Projects\\repo')
    expect(checkoutOf(`${WORKTREE}\\web`, 'win32')).toBe('D:\\Projects\\repo')
    expect(checkoutOf('/srv/repo/.claude/worktrees/repo-2', 'linux')).toBe('/srv/repo')
  })

  it('is the folder itself outside a worktree', () => {
    expect(checkoutOf('D:\\Projects\\repo', 'win32')).toBe('D:\\Projects\\repo')
    expect(checkoutOf('/srv/repo/.claude', 'linux')).toBe('/srv/repo/.claude')
  })
})

describe('sharedFile', () => {
  const share = shareOf(
    {
      files: [
        'D:/Projects/repo/.temp/audit.md',
        'shot.PNG',
        'D:/Projects/other/secret.txt',
        'D:/Projects/repo-old/x.md',
        'dump.bin',
        '..\\..\\..\\..\\other\\secret.txt',
      ],
    },
    WORKTREE,
  )

  it('gives a file of the worktree or of its main checkout, resolved against the folder of the call, with its type', () => {
    expect(sharedFile(share, 0, 'win32')).toEqual({ path: 'D:\\Projects\\repo\\.temp\\audit.md', type: 'text/markdown; charset=utf-8' })
    expect(sharedFile(share, 1, 'win32')).toEqual({ path: `${WORKTREE}\\shot.PNG`, type: 'image/png' })
    expect(sharedFile(share, 4, 'win32')).toEqual({ path: `${WORKTREE}\\dump.bin`, type: 'application/octet-stream' })
    expect(sharedFile(shareOf({ files: ['/srv/repo/.temp/a.md'] }, '/srv/repo/.claude/worktrees/t'), 0, 'linux')?.path).toBe('/srv/repo/.temp/a.md')
  })

  it('refuses a file outside both, a missing index and a call without its folder', () => {
    expect(sharedFile(share, 2, 'win32')).toBeUndefined()
    expect(sharedFile(share, 3, 'win32')).toBeUndefined()
    expect(sharedFile(share, 5, 'win32')).toBeUndefined()
    expect(sharedFile(share, 9, 'win32')).toBeUndefined()
    expect(sharedFile(shareOf({ files: ['/etc/passwd'] }, ''), 0, 'linux')).toBeUndefined()
  })
})
