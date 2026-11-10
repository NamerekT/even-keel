import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runGit } from '../git/run.js'
import type { Git } from '../git/types.js'
import { gitSwitchBlock, taskWorktrees, turnGitOn } from './git-mode.js'

const IDENTITY = ['-c', 'user.name=John Doe', '-c', 'user.email=john@example.com']
/** Real git with a name and e-mail of its own and no hooks, whatever the machine's config says. */
const git: Git = (cwd, args) => runGit(cwd, [...IDENTITY, '-c', `core.hooksPath=${join(cwd, 'no-hooks')}`, ...args])
const nameless: Git = (cwd, args) => runGit(cwd, ['-c', 'user.name=', '-c', 'user.email=', ...args])

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

function folder(): string {
  const made = mkdtempSync(join(tmpdir(), 'ek-git-mode-'))
  folders.push(made)
  return made
}

const out = async (cwd: string, ...args: string[]) => (await git(cwd, args)).out.trim()

describe('turnGitOn', { timeout: 30_000 }, () => {
  it('makes the folder a repository on the branch and commits what is there, Even Keel’s folders left out', async () => {
    const path = folder()
    writeFileSync(join(path, 'notes.md'), 'kept')
    mkdirSync(join(path, '.temp'))
    writeFileSync(join(path, '.temp', 'handoff-abc-1.md'), 'scratch')
    expect(await turnGitOn(git, path, 'ABC', 'trunk')).toEqual({ made: true })
    expect(await out(path, 'symbolic-ref', '--short', 'HEAD')).toBe('trunk')
    expect((await out(path, 'ls-tree', '--name-only', 'HEAD')).split(/\r?\n/)).toEqual(['notes.md'])
    expect(await out(path, 'status', '--porcelain')).toBe('')
    const exclude = readFileSync(join(path, '.git', 'info', 'exclude'), 'utf8')
    expect(exclude).toContain('.claude/worktrees/')
    expect(exclude).toContain('.temp/')
  })

  it('makes an empty folder a repository with an empty first commit', async () => {
    const path = folder()
    await turnGitOn(git, path, 'ABC', 'main')
    expect(await out(path, 'rev-list', '--count', 'HEAD')).toBe('1')
  })

  it('gives an unborn repository the branch and the first commit', async () => {
    const path = folder()
    await git(path, ['init', '-q', '-b', 'other'])
    writeFileSync(join(path, 'a.txt'), 'a')
    expect(await turnGitOn(git, path, 'ABC', 'main')).toEqual({ made: true })
    expect(await out(path, 'symbolic-ref', '--short', 'HEAD')).toBe('main')
    expect(await out(path, 'ls-tree', '--name-only', 'HEAD')).toBe('a.txt')
  })

  it('leaves a repository with commits as it is when the branch is there', async () => {
    const path = folder()
    await git(path, ['init', '-q', '-b', 'main'])
    await git(path, ['commit', '-q', '--allow-empty', '-m', 'mine'])
    writeFileSync(join(path, 'loose.txt'), 'not committed')
    expect(await turnGitOn(git, path, 'ABC', 'main')).toEqual({ made: false })
    expect(await out(path, 'rev-list', '--count', 'HEAD')).toBe('1')
    expect(await out(path, 'status', '--porcelain')).toBe('?? loose.txt')
  })

  it('refuses a repository without the branch', async () => {
    const path = folder()
    await git(path, ['init', '-q', '-b', 'master'])
    await git(path, ['commit', '-q', '--allow-empty', '-m', 'mine'])
    await expect(turnGitOn(git, path, 'ABC', 'main')).rejects.toMatchObject({ notice: { code: 'git.noBranch' } })
  })

  it('makes a folder inside another repository one of its own', async () => {
    const outer = folder()
    await git(outer, ['init', '-q', '-b', 'main'])
    await git(outer, ['commit', '-q', '--allow-empty', '-m', 'outer'])
    const path = join(outer, 'inner')
    mkdirSync(path)
    writeFileSync(join(path, 'b.txt'), 'b')
    expect(await turnGitOn(git, path, 'ABC', 'main')).toEqual({ made: true })
    expect(await out(path, 'rev-list', '--count', 'HEAD')).toBe('1')
    expect(await out(path, 'ls-tree', '--name-only', 'HEAD')).toBe('b.txt')
  })

  it('refuses without a name and e-mail and leaves the folder as it was', async () => {
    const path = folder()
    await expect(turnGitOn(nameless, path, 'ABC', 'main')).rejects.toMatchObject({ notice: { code: 'git.noIdentity' } })
    expect((await git(path, ['rev-parse', '--show-toplevel'])).code).not.toBe(0)
  })

  it('refuses a bad branch name and a missing folder', async () => {
    const path = folder()
    await expect(turnGitOn(git, path, 'ABC', 'a..b')).rejects.toMatchObject({ notice: { code: 'wizard.branchName' } })
    await expect(turnGitOn(git, join(path, 'gone'), 'ABC', 'main')).rejects.toMatchObject({ notice: { code: 'wizard.noFolder' } })
  })
})

describe('taskWorktrees', { timeout: 30_000 }, () => {
  it('lists the worktrees besides the main checkout, none for a folder without git', async () => {
    const path = folder()
    expect(await taskWorktrees(git, path)).toEqual([])
    await turnGitOn(git, path, 'ABC', 'main')
    expect(await taskWorktrees(git, path)).toEqual([])
    await git(path, ['worktree', 'add', '-q', '-b', 'abc-1/task', join(path, '.claude', 'worktrees', 'abc-1')])
    const found = await taskWorktrees(git, path)
    expect(found).toHaveLength(1)
    expect(found[0]!.replaceAll('\\', '/')).toMatch(/\/\.claude\/worktrees\/abc-1$/)
  })
})

describe('gitSwitchBlock', () => {
  const idle = { project: 'ABC', sessions: [], held: [] }

  it('lets the switch through between tasks', () => {
    expect(gitSwitchBlock(idle, null)).toBeNull()
  })

  it('names each reason: the task in hand, live sessions, held places', () => {
    const block = gitSwitchBlock({ project: 'ABC', sessions: ['ABC-1 (s1)'], held: ['ABC-2'] }, 'ABC-1')
    expect(block?.code).toBe('project.gitBusy')
    expect(block?.items?.map((item) => item.code)).toEqual(['project.gitTaskInHand', 'project.removeSessions', 'project.removePlaces'])
  })
})
