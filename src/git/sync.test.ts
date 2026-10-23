import { describe, expect, it } from 'vitest'
import type { GitResult } from './types.js'
import { fastForwardMain, isNetworkFailure, syncMain } from './sync.js'
import { notice } from '../notice/notice.js'

const repo = '/home/john/repo'

/** An answer given as a list is used up in order, the last one repeating. */
function fakeGit(answers: Record<string, Partial<GitResult> | Partial<GitResult>[]> = {}) {
  const calls: string[] = []
  const git = async (cwd: string, args: string[]): Promise<GitResult> => {
    expect(cwd).toBe(repo)
    const command = args.join(' ')
    calls.push(command)
    const answer = answers[command]
    return { code: 0, out: '', ...(Array.isArray(answer) ? (answer.length > 1 ? answer.shift() : answer[0]) : answer) }
  }
  return { git, calls }
}

const rejected = { code: 1, out: ' ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs' }

const builtIn = { 'config --get alias.sync': { code: 1 }, 'branch --show-current': { out: 'main' } }

describe('syncMain', () => {
  it('runs the git sync alias when the repository or the user has one', async () => {
    const { git, calls } = fakeGit({ 'config --get alias.sync': { out: '!sh ~/.githooks/git-sync.sh' } })
    expect(await syncMain(git, repo, ['origin'])).toBeNull()
    expect(calls).toEqual(['config --get alias.sync', 'sync'])
  })

  it('reports a failed alias with its output', async () => {
    const { git } = fakeGit({ sync: { code: 1, out: 'sync: switch to main first' } })
    expect(await syncMain(git, repo, ['origin'])).toEqual(notice('sync.alias', { exit: 1 }, { detail: 'sync: switch to main first' }))
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

  it('syncs a main branch named otherwise by itself, past the user’s alias made for main', async () => {
    const { git, calls } = fakeGit({
      'config --local --get alias.sync': { code: 1 },
      'config --get alias.sync': { out: '!sh ~/.githooks/git-sync.sh' },
      'branch --show-current': { out: 'master' },
    })
    expect(await syncMain(git, repo, ['origin'], 'master')).toBeNull()
    expect(calls).toEqual([
      'config --local --get alias.sync',
      'branch --show-current',
      'fetch origin',
      'rev-parse --verify --quiet refs/remotes/origin/master',
      'merge --no-edit origin/master',
      'push origin master',
    ])
  })

  it('runs the repository’s own alias whatever the main branch is called', async () => {
    const { git, calls } = fakeGit({ 'config --local --get alias.sync': { out: '!sh sync.sh' } })
    expect(await syncMain(git, repo, ['origin'], 'master')).toBeNull()
    expect(calls).toEqual(['config --local --get alias.sync', 'sync'])
  })

  it('names the main branch it expected when the checkout is elsewhere', async () => {
    const { git } = fakeGit({ 'config --local --get alias.sync': { code: 1 }, 'branch --show-current': { out: 'main' } })
    expect(await syncMain(git, repo, ['origin'], 'master')).toEqual(notice('sync.notMain', { repo, branch: 'main', main: 'master' }))
  })

  it('refuses when the main checkout is not on main', async () => {
    const { git, calls } = fakeGit({ ...builtIn, 'branch --show-current': { out: 'abc-7/task' } })
    expect(await syncMain(git, repo, ['origin'])).toEqual(notice('sync.notMain', { repo, branch: 'abc-7/task', main: 'main' }))
    expect(calls.some((call) => call.startsWith('fetch'))).toBe(false)
  })

  it('aborts a merge that does not go cleanly and pushes nothing', async () => {
    const { git, calls } = fakeGit({ ...builtIn, 'merge --no-edit origin/main': { code: 1, out: 'CONFLICT (content): a.ts' } })
    expect(await syncMain(git, repo, ['origin'])).toEqual(notice('sync.merge', { remote: 'origin', main: 'main' }, { detail: 'CONFLICT (content): a.ts' }))
    expect(calls).toContain('merge --abort')
    expect(calls.some((call) => call.startsWith('push'))).toBe(false)
  })

  it('stops at a fetch that fails', async () => {
    const { git, calls } = fakeGit({ ...builtIn, 'fetch origin': { code: 128, out: 'could not resolve host' } })
    expect(await syncMain(git, repo, ['origin'])).toEqual(notice('sync.fetch', { remote: 'origin' }, { detail: 'could not resolve host' }))
    expect(calls.some((call) => call.startsWith('push'))).toBe(false)
  })

  it('reports a push that fails otherwise, without a second try', async () => {
    const { git, calls } = fakeGit({ ...builtIn, 'push origin main': { code: 128, out: 'Authentication failed' } })
    expect(await syncMain(git, repo, ['origin'])).toEqual(notice('sync.push', { remote: 'origin', main: 'main' }, { detail: 'Authentication failed' }))
    expect(calls.filter((call) => call === 'push origin main')).toHaveLength(1)
  })

  // Another clone of the same remote pushed between this one's fetch and push (BTN-210).
  it('syncs once more when the remote moved between the fetch and the push', async () => {
    const { git, calls } = fakeGit({ ...builtIn, 'push origin main': [rejected, { code: 0 }] })
    expect(await syncMain(git, repo, ['origin'])).toBeNull()
    expect(calls.filter((call) => call === 'fetch origin')).toHaveLength(2)
    expect(calls.filter((call) => call === 'merge --no-edit origin/main')).toHaveLength(2)
  })

  it('reports the push rejected twice', async () => {
    const { git, calls } = fakeGit({ ...builtIn, 'push origin main': rejected })
    expect(await syncMain(git, repo, ['origin'])).toEqual(notice('sync.push', { remote: 'origin', main: 'main' }, { detail: rejected.out }))
    expect(calls.filter((call) => call === 'push origin main')).toHaveLength(2)
  })

  it('runs the alias once more when its push was rejected', async () => {
    const { git, calls } = fakeGit({ 'config --get alias.sync': { out: '!sh ~/.githooks/git-sync.sh' }, sync: [rejected, { code: 0 }] })
    expect(await syncMain(git, repo, ['origin'])).toBeNull()
    expect(calls.filter((call) => call === 'sync')).toHaveLength(2)
  })

  it('does not run the alias again after a conflict', async () => {
    const { git, calls } = fakeGit({ 'config --get alias.sync': { out: '!sh sync.sh' }, sync: { code: 1, out: 'sync: origin/main does not merge cleanly' } })
    expect((await syncMain(git, repo, ['origin']))?.code).toBe('sync.alias')
    expect(calls.filter((call) => call === 'sync')).toHaveLength(1)
  })
})

describe('isNetworkFailure', () => {
  const unreachable = "fatal: unable to access 'https://github.com/john/repo.git/': Failed to connect to github.com port 443 after 21096 ms: Couldn't connect to server"

  it('takes a fetch, a push or the alias that could not reach the remote', () => {
    expect(isNetworkFailure(notice('sync.fetch', { remote: 'github' }, { detail: unreachable }))).toBe(true)
    expect(isNetworkFailure(notice('sync.push', { remote: 'origin', main: 'main' }, { detail: 'fatal: unable to access: Could not resolve host: git.example.com' }))).toBe(true)
    expect(isNetworkFailure(notice('sync.alias', { exit: 1 }, { detail: 'ssh: connect to host git.example.com port 22: Connection timed out' }))).toBe(true)
    expect(isNetworkFailure(notice('sync.fetch', { remote: 'origin' }, { detail: 'error: RPC failed; curl 56 Recv failure: Connection reset by peer' }))).toBe(true)
  })

  it('leaves a refusal of the remote and anything but a fetch or a push', () => {
    expect(isNetworkFailure(notice('sync.push', { remote: 'origin', main: 'main' }, { detail: rejected.out }))).toBe(false)
    expect(isNetworkFailure(notice('sync.push', { remote: 'origin', main: 'main' }, { detail: 'remote: Permission denied\nfatal: unable to access: The requested URL returned error: 403' }))).toBe(false)
    expect(isNetworkFailure(notice('sync.merge', { remote: 'origin', main: 'main' }, { detail: 'Failed to connect' }))).toBe(false)
    expect(isNetworkFailure(notice('sync.notMain', { repo, branch: 'abc-7/task', main: 'main' }))).toBe(false)
  })
})

describe('fastForwardMain', () => {
  const clean = {
    'branch --show-current': { out: 'main' },
    'status --porcelain --untracked-files=no': { out: '' },
    remote: { out: 'origin\nmirror' },
  }

  it('fast-forwards main to the main of every remote', async () => {
    const { git, calls } = fakeGit(clean)
    await fastForwardMain(git, repo)
    expect(calls).toEqual([
      'branch --show-current',
      'status --porcelain --untracked-files=no',
      'remote',
      'fetch origin',
      'rev-parse --verify --quiet refs/remotes/origin/main',
      'merge --ff-only origin/main',
      'fetch mirror',
      'rev-parse --verify --quiet refs/remotes/mirror/main',
      'merge --ff-only mirror/main',
    ])
  })

  it('leaves a checkout that is not on main', async () => {
    const { git, calls } = fakeGit({ ...clean, 'branch --show-current': { out: 'abc-7/task' } })
    await fastForwardMain(git, repo)
    expect(calls).toEqual(['branch --show-current'])
  })

  it('leaves a checkout with changes to tracked files', async () => {
    const { git, calls } = fakeGit({ ...clean, 'status --porcelain --untracked-files=no': { out: ' M a.ts' } })
    await fastForwardMain(git, repo)
    expect(calls.some((call) => call.startsWith('fetch') || call.startsWith('merge'))).toBe(false)
  })

  it('goes past a remote that fails to fetch or has no main', async () => {
    const { git, calls } = fakeGit({ ...clean, 'fetch origin': { code: 128 }, 'rev-parse --verify --quiet refs/remotes/mirror/main': { code: 1 } })
    await fastForwardMain(git, repo)
    expect(calls.some((call) => call.startsWith('merge'))).toBe(false)
  })

  it('takes the main branch by its name', async () => {
    const { git, calls } = fakeGit({ ...clean, 'branch --show-current': { out: 'master' }, remote: { out: 'origin' } })
    await fastForwardMain(git, repo, 'master')
    expect(calls).toContain('merge --ff-only origin/master')
  })
})
