import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureIgnored, finishWorktree, parseWorktrees, prepareWorktree, taskPlace, type GitResult } from './worktree.js'

const repo = join(tmpdir(), 'abc')
const place = join(repo, '.claude', 'worktrees', 'abc-7')
const porcelainPath = place.replaceAll('\\', '/')

function fakeGit(answers: Record<string, Partial<GitResult> | Partial<GitResult>[]> = {}) {
  const calls: string[] = []
  const git = async (cwd: string, args: string[]): Promise<GitResult> => {
    expect(cwd).toBe(repo)
    const command = args.join(' ')
    calls.push(command)
    const answer = answers[command]
    const next = Array.isArray(answer) ? (answer.length > 1 ? answer.shift() : answer[0]) : answer
    return { code: 0, out: '', ...next }
  }
  return { git, calls }
}

const listing = (...trees: [string, string | null][]) => ({
  out: trees
    .map(([path, branch]) => [`worktree ${path}`, 'HEAD 25064bcf', branch === null ? 'detached' : `branch refs/heads/${branch}`].join('\n'))
    .join('\n\n'),
})

const main: [string, string] = [repo.replaceAll('\\', '/'), 'main']

describe('taskPlace', () => {
  it('names the worktree and the branch after the task in lower case', () => {
    expect(taskPlace(repo, 'ABC-7')).toEqual({ path: place, branch: 'abc-7/task' })
  })
})

describe('parseWorktrees', () => {
  it('reads paths and branches, a detached tree has none', () => {
    expect(parseWorktrees(listing(main, [porcelainPath, 'abc-7/task'], ['C:/x', null]).out)).toEqual([
      { path: main[0], branch: 'main' },
      { path: porcelainPath, branch: 'abc-7/task' },
      { path: 'C:/x', branch: null },
    ])
  })
})

describe('prepareWorktree', () => {
  it('adds a new worktree on a new branch off main', async () => {
    const { git, calls } = fakeGit({ 'worktree list --porcelain': listing(main), 'rev-parse --verify --quiet refs/heads/abc-7/task': { code: 1 } })
    expect(await prepareWorktree(git, repo, 'ABC-7')).toEqual({ path: place, branch: 'abc-7/task' })
    expect(calls).toContain(`worktree add -b abc-7/task ${place} main`)
  })

  it('takes an existing worktree as it is, with its own branch', async () => {
    const { git, calls } = fakeGit({ 'worktree list --porcelain': listing(main, [porcelainPath, 'abc-7/by-hand']) })
    expect(await prepareWorktree(git, repo, 'ABC-7')).toEqual({ path: place, branch: 'abc-7/by-hand' })
    expect(calls.some((call) => call.startsWith('worktree add'))).toBe(false)
  })

  it('puts an existing branch back into a new worktree', async () => {
    const { git, calls } = fakeGit({ 'worktree list --porcelain': listing(main) })
    expect(await prepareWorktree(git, repo, 'ABC-7')).toEqual({ path: place, branch: 'abc-7/task' })
    expect(calls).toContain(`worktree add ${place} abc-7/task`)
  })

  it('prunes stale worktrees before looking', async () => {
    const { git, calls } = fakeGit({ 'worktree list --porcelain': listing(main) })
    await prepareWorktree(git, repo, 'ABC-7')
    expect(calls.indexOf('worktree prune')).toBeLessThan(calls.indexOf('worktree list --porcelain'))
  })

  it('fails with the output of git when the worktree cannot be added', async () => {
    const { git } = fakeGit({
      'worktree list --porcelain': listing(main),
      [`worktree add ${place} abc-7/task`]: { code: 128, out: "fatal: 'abc-7/task' is already used by worktree" },
    })
    await expect(prepareWorktree(git, repo, 'ABC-7')).rejects.toThrow(/already used by worktree/)
  })
})

describe('ensureIgnored', () => {
  let dir: string | undefined
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }))

  it('adds the worktrees folder to the exclude file when git does not ignore it', async () => {
    dir = mkdtempSync(join(tmpdir(), 'baton-exclude-'))
    const exclude = join(dir, 'exclude')
    writeFileSync(exclude, '# git ls-files --others --exclude-from=.git/info/exclude')
    const { git } = fakeGit({ 'check-ignore -q .claude/worktrees/probe': { code: 1 }, 'rev-parse --git-path info/exclude': { out: exclude } })
    await ensureIgnored(git, repo)
    expect(readFileSync(exclude, 'utf8')).toBe('# git ls-files --others --exclude-from=.git/info/exclude\n.claude/worktrees/\n')
  })

  it('leaves the exclude file alone when the folder is already ignored', async () => {
    const { git, calls } = fakeGit({ 'check-ignore -q .claude/worktrees/probe': { code: 0 } })
    await ensureIgnored(git, repo)
    expect(calls).toEqual(['check-ignore -q .claude/worktrees/probe'])
  })
})

describe('finishWorktree', () => {
  const clean = {
    'worktree list --porcelain': listing(main, [porcelainPath, 'abc-7/task']),
    remote: { out: 'origin\n' },
  }

  it('removes the worktree and the branch here and on origin, then syncs', async () => {
    const { git, calls } = fakeGit(clean)
    expect(await finishWorktree(git, repo, 'ABC-7')).toEqual({ warnings: [], syncError: null })
    expect(calls.filter((call) => !call.startsWith('worktree list') && call !== 'worktree prune')).toEqual([
      `worktree remove ${place}`,
      'branch -d abc-7/task',
      'remote',
      'ls-remote --exit-code --heads origin refs/heads/abc-7/task',
      'push origin --delete abc-7/task',
      'sync',
    ])
  })

  it('does not delete a branch origin does not have', async () => {
    const { git, calls } = fakeGit({ ...clean, 'ls-remote --exit-code --heads origin refs/heads/abc-7/task': { code: 2 } })
    expect(await finishWorktree(git, repo, 'ABC-7')).toEqual({ warnings: [], syncError: null })
    expect(calls).not.toContain('push origin --delete abc-7/task')
    expect(calls).toContain('sync')
  })

  it('does not sync a project without remotes', async () => {
    const { git, calls } = fakeGit({ ...clean, remote: { out: '' } })
    expect(await finishWorktree(git, repo, 'ABC-7')).toEqual({ warnings: [], syncError: null })
    expect(calls).not.toContain('sync')
    expect(calls.some((call) => call.startsWith('ls-remote'))).toBe(false)
  })

  it('keeps a dirty worktree and its branch, warns and still syncs', async () => {
    const { git, calls } = fakeGit({
      ...clean,
      [`worktree remove ${place}`]: { code: 128, out: "fatal: '.claude/worktrees/abc-7' contains modified or untracked files" },
    })
    const outcome = await finishWorktree(git, repo, 'ABC-7')
    expect(outcome.syncError).toBeNull()
    expect(outcome.warnings).toEqual([expect.stringMatching(/ABC-7.*contains modified or untracked files/)])
    expect(calls.some((call) => call.startsWith('branch -d'))).toBe(false)
    expect(calls).toContain('sync')
  })

  it('warns about a folder left behind by a busy process and still deletes the branch', async () => {
    const { git, calls } = fakeGit({
      ...clean,
      'worktree list --porcelain': [listing(main, [porcelainPath, 'abc-7/task']), listing(main)],
      [`worktree remove ${place}`]: { code: 255, out: 'error: failed to delete: Permission denied' },
    })
    const outcome = await finishWorktree(git, repo, 'ABC-7')
    expect(outcome.warnings).toEqual([expect.stringMatching(/left behind.*Permission denied/)])
    expect(calls).toContain('branch -d abc-7/task')
  })

  it('warns about an unmerged branch and keeps it on origin too', async () => {
    const { git, calls } = fakeGit({ ...clean, 'branch -d abc-7/task': { code: 1, out: "error: the branch 'abc-7/task' is not fully merged" } })
    const outcome = await finishWorktree(git, repo, 'ABC-7')
    expect(outcome.warnings).toEqual([expect.stringMatching(/not fully merged/)])
    expect(calls).not.toContain('push origin --delete abc-7/task')
    expect(calls).toContain('sync')
  })

  it('deletes the task branch even when its worktree is already gone', async () => {
    const { git, calls } = fakeGit({ ...clean, 'worktree list --porcelain': listing(main) })
    expect(await finishWorktree(git, repo, 'ABC-7')).toEqual({ warnings: [], syncError: null })
    expect(calls).toContain('branch -d abc-7/task')
  })

  it('has nothing to remove when neither the worktree nor the branch is there', async () => {
    const { git, calls } = fakeGit({
      ...clean,
      'worktree list --porcelain': listing(main),
      'rev-parse --verify --quiet refs/heads/abc-7/task': { code: 1 },
    })
    expect(await finishWorktree(git, repo, 'ABC-7')).toEqual({ warnings: [], syncError: null })
    expect(calls.some((call) => call.startsWith('branch -d'))).toBe(false)
  })

  it('never deletes a branch that is not the task’s own', async () => {
    const { git, calls } = fakeGit({ ...clean, 'worktree list --porcelain': listing(main, [porcelainPath, 'main-copy']) })
    await finishWorktree(git, repo, 'ABC-7')
    expect(calls.some((call) => call.startsWith('branch -d'))).toBe(false)
  })

  it('reports a failed sync with its output', async () => {
    const { git } = fakeGit({ ...clean, sync: { code: 1, out: 'sync: origin/main does not merge cleanly into main, merge it by hand' } })
    expect(await finishWorktree(git, repo, 'ABC-7')).toEqual({
      warnings: [],
      syncError: 'sync: origin/main does not merge cleanly into main, merge it by hand',
    })
  })
})
