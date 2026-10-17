import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { HandoffSession } from '../chain/relay.js'
import { locateWorktree } from './place.js'

const repo = join(tmpdir(), 'abc')
const tree = join(repo, '.claude', 'worktrees', 'abc-7')
const common = join(repo, '.git')

const session = (cwd: string, workdir: string): HandoffSession => ({
  sessionId: 's-1',
  agentId: 's-1',
  account: 'global',
  cwd,
  workdir,
  branch: null,
  transcript: null,
  lastReplyAt: null,
  recent: [],
  lastMessage: null,
  checkpoint: null,
})

/** Each folder answers with its top level, its common git dir and its branch. */
function fakeGit(folders: Record<string, { top: string; common: string; branch: string }>) {
  return async (cwd: string, ...args: string[]): Promise<string | null> => {
    const folder = folders[cwd]
    if (folder === undefined) return null
    if (args.includes('--show-toplevel')) return folder.top
    if (args.includes('--git-common-dir')) return folder.common
    return folder.branch
  }
}

describe('locateWorktree', () => {
  it('takes the worktree the session moved into from the main checkout', async () => {
    const git = fakeGit({
      [repo]: { top: repo, common, branch: 'main' },
      [join(tree, 'src')]: { top: tree, common, branch: 'abc-7/task' },
      [tree]: { top: tree, common, branch: 'abc-7/task' },
    })
    expect(await locateWorktree(session(repo, join(tree, 'src')), git)).toMatchObject({ workdir: tree, branch: 'abc-7/task' })
  })

  it('does not take a repository the session cloned inside its worktree', async () => {
    const clone = join(tree, '.temp', 'trial')
    const git = fakeGit({
      [tree]: { top: tree, common, branch: 'abc-7/task' },
      [clone]: { top: clone, common: join(clone, '.git'), branch: 'main' },
      [join(tree, '.temp')]: { top: tree, common, branch: 'abc-7/task' },
    })
    expect(await locateWorktree(session(tree, clone), git)).toMatchObject({ workdir: tree, branch: 'abc-7/task' })
  })

  it('keeps the session as it is outside git', async () => {
    const plain = session(join(tmpdir(), 'plain'), join(tmpdir(), 'plain'))
    expect(await locateWorktree(plain, fakeGit({}))).toBe(plain)
  })
})
