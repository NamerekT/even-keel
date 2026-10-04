import { describe, expect, it } from 'vitest'
import type { GitResult } from './types.js'
import { syncMain } from './sync.js'

const repo = '/home/john/repo'

function fakeGit(answers: Record<string, Partial<GitResult>> = {}) {
  const calls: string[] = []
  const git = async (cwd: string, args: string[]): Promise<GitResult> => {
    expect(cwd).toBe(repo)
    const command = args.join(' ')
    calls.push(command)
    return { code: 0, out: '', ...answers[command] }
  }
  return { git, calls }
}

const builtIn = { 'config --get alias.sync': { code: 1 }, 'branch --show-current': { out: 'main' } }

describe('syncMain', () => {
  it('runs the git sync alias when the repository or the user has one', async () => {
    const { git, calls } = fakeGit({ 'config --get alias.sync': { out: '!sh ~/.githooks/git-sync.sh' } })
    expect(await syncMain(git, repo, ['origin'])).toBeNull()
    expect(calls).toEqual(['config --get alias.sync', 'sync'])
  })

  it('reports a failed alias with its output', async () => {
    const { git } = fakeGit({ sync: { code: 1, out: 'sync: switch to main first' } })
    expect(await syncMain(git, repo, ['origin'])).toBe('sync: switch to main first')
  })

  it('without the alias, merges main of every remote, then pushes main to each', async () => {
    const { git, calls } = fakeGit(builtIn)
    expect(await syncMain(git, repo, ['origin', 'mirror'])).toBeNull()
    expect(calls).toEqual([
      'config --get alias.sync',
      'branch --show-current',
      'fetch origin',
      'rev-parse --verify --quiet refs/remotes/origin/main',
      'merge --no-edit origin/main',
      'fetch mirror',
      'rev-parse --verify --quiet refs/remotes/mirror/main',
      'merge --no-edit mirror/main',
      'push origin main',
      'push mirror main',
    ])
  })

  it('skips the merge from a remote that has no main yet and still pushes to it', async () => {
    const { git, calls } = fakeGit({ ...builtIn, 'rev-parse --verify --quiet refs/remotes/origin/main': { code: 1 } })
    expect(await syncMain(git, repo, ['origin'])).toBeNull()
    expect(calls).not.toContain('merge --no-edit origin/main')
    expect(calls).toContain('push origin main')
  })

  it('refuses when the main checkout is not on main', async () => {
    const { git, calls } = fakeGit({ ...builtIn, 'branch --show-current': { out: 'abc-7/task' } })
    expect(await syncMain(git, repo, ['origin'])).toBe(`sync: ${repo} is on abc-7/task, not main; switch it to main`)
    expect(calls.some((call) => call.startsWith('fetch'))).toBe(false)
  })

  it('aborts a merge that does not go cleanly and pushes nothing', async () => {
    const { git, calls } = fakeGit({ ...builtIn, 'merge --no-edit origin/main': { code: 1, out: 'CONFLICT (content): a.ts' } })
    expect(await syncMain(git, repo, ['origin'])).toBe('sync: origin/main does not merge cleanly into main, merge it by hand: CONFLICT (content): a.ts')
    expect(calls).toContain('merge --abort')
    expect(calls.some((call) => call.startsWith('push'))).toBe(false)
  })

  it('stops at a fetch that fails', async () => {
    const { git, calls } = fakeGit({ ...builtIn, 'fetch origin': { code: 128, out: 'could not resolve host' } })
    expect(await syncMain(git, repo, ['origin'])).toBe('sync: could not fetch origin: could not resolve host')
    expect(calls.some((call) => call.startsWith('push'))).toBe(false)
  })

  it('reports a rejected push', async () => {
    const { git } = fakeGit({ ...builtIn, 'push origin main': { code: 1, out: 'rejected' } })
    expect(await syncMain(git, repo, ['origin'])).toBe('sync: could not push main to origin: rejected')
  })
})
