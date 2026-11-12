import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runGit } from '../git/run.js'
import type { Git } from '../git/types.js'
import { gitSwitchBlock, taskWorktrees, turnGitOn, uncommittedChanges } from './git-mode.js'

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

/**
 * An existing repository on main with a history of its own, as when it is added as a project without git and git is
 * turned on later (BTN-1054): the files written into it meanwhile stay uncommitted.
 */
async function repository(): Promise<string> {
  const path = folder()
  await git(path, ['init', '-q', '-b', 'main'])
  writeFileSync(join(path, 'kept.txt'), 'kept\n')
  await git(path, ['add', '-A'])
  await git(path, ['commit', '-q', '-m', 'first'])
  await git(path, ['commit', '-q', '--allow-empty', '-m', 'second'])
  return path
}

describe('turnGitOn', { timeout: 30_000 }, () => {
  it('makes the folder a repository on the branch and commits what is there, Even Keel’s folders left out', async () => {
    const path = folder()
    writeFileSync(join(path, 'notes.md'), 'kept')
    mkdirSync(join(path, '.temp'))
    writeFileSync(join(path, '.temp', 'handoff-abc-1.md'), 'scratch')
    expect(await turnGitOn(git, path, 'ABC', 'trunk')).toEqual({ made: true, committed: false })
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
    expect(await turnGitOn(git, path, 'ABC', 'main')).toEqual({ made: true, committed: false })
    expect(await out(path, 'symbolic-ref', '--short', 'HEAD')).toBe('main')
    expect(await out(path, 'ls-tree', '--name-only', 'HEAD')).toBe('a.txt')
  })

  it('leaves a clean repository with commits as it is when the branch is there', async () => {
    const path = await repository()
    expect(await uncommittedChanges(git, path)).toEqual([])
    expect(await turnGitOn(git, path, 'ABC', 'main')).toEqual({ made: false, committed: false })
    expect(await turnGitOn(git, path, 'ABC', 'main', { commit: true })).toEqual({ made: false, committed: false })
    expect(await out(path, 'rev-list', '--count', 'HEAD')).toBe('2')
  })

  it('commits the work done without git in one commit when asked, Even Keel’s folders left out', async () => {
    const path = await repository()
    writeFileSync(join(path, 'kept.txt'), 'kept\nfourth\n')
    writeFileSync(join(path, 'loose.txt'), 'new')
    mkdirSync(join(path, '.temp'))
    writeFileSync(join(path, '.temp', 'handoff-abc-1.md'), 'scratch')
    expect(await uncommittedChanges(git, path)).toEqual(['M kept.txt', '?? loose.txt'])
    expect(await turnGitOn(git, path, 'ABC', 'main', { commit: true })).toEqual({ made: false, committed: true })
    expect(await out(path, 'rev-list', '--count', 'HEAD')).toBe('3')
    expect(await out(path, 'log', '-1', '--format=%s|%an|%ae')).toBe('Work done without git|John Doe|john@example.com')
    expect((await out(path, 'show', '--name-only', '--format=', 'HEAD')).split(/\r?\n/)).toEqual(['kept.txt', 'loose.txt'])
    expect(await out(path, 'status', '--porcelain')).toBe('')
  })

  it('refuses a repository with work done without git when not asked to commit it, naming the changes', async () => {
    const path = await repository()
    writeFileSync(join(path, 'loose file.txt'), 'new')
    await git(path, ['mv', 'kept.txt', 'moved.txt'])
    await expect(turnGitOn(git, path, 'ABC', 'main')).rejects.toMatchObject({
      notice: { code: 'project.gitDirty', params: { project: 'ABC', files: ['R kept.txt → moved.txt', '?? loose file.txt'] } },
    })
    expect(await out(path, 'rev-list', '--count', 'HEAD')).toBe('2')
  })

  it('refuses to commit the work done without git off the project’s branch', async () => {
    const path = await repository()
    await git(path, ['switch', '-q', '-c', 'side'])
    writeFileSync(join(path, 'loose.txt'), 'new')
    await expect(turnGitOn(git, path, 'ABC', 'main', { commit: true })).rejects.toMatchObject({ notice: { code: 'git.wrongBranch' } })
    expect(await out(path, 'rev-list', '--count', 'HEAD')).toBe('2')
    expect(await out(path, 'status', '--porcelain')).toBe('?? loose.txt')
  })

  it('lists no changes for a folder that is no repository of its own or has no commits', async () => {
    const path = folder()
    writeFileSync(join(path, 'a.txt'), 'a')
    expect(await uncommittedChanges(git, path)).toEqual([])
    await git(path, ['init', '-q', '-b', 'main'])
    expect(await uncommittedChanges(git, path)).toEqual([])
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
    expect(await turnGitOn(git, path, 'ABC', 'main')).toEqual({ made: true, committed: false })
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
