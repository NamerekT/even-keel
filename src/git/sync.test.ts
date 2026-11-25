import { describe, expect, it } from 'vitest'
import type { GitResult } from './types.js'
import { fastForwardMain, fastForwardTo, syncMain, transientFailure } from './sync.js'
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

  it('names the profile whose token may not write, for a push and for the alias (BTN-1541)', async () => {
    const denied = { profile: 'p1', name: 'John GitHub', url: 'https://github.com/john/repo.git' }
    const out = 'remote: Write access to repository not granted.'
    const expected = notice('git.readOnly', { profile: 'John GitHub', url: denied.url }, { detail: out })
    const pushed = fakeGit({ ...builtIn, 'push origin main': { code: 128, out, denied } })
    expect(await syncMain(pushed.git, repo, ['origin'])).toEqual(expected)
    const alias = fakeGit({ 'config --get alias.sync': { out: '!git fetch --all' }, sync: { code: 1, out, denied } })
    expect(await syncMain(alias.git, repo, ['origin'])).toEqual(expected)
  })

  // Another clone of the same remote pushed between this one's fetch and push (BTN-210).
  it('syncs once more when the remote moved between the fetch and the push', async () => {
    const { git, calls } = fakeGit({ ...builtIn, 'push origin main': [rejected, { code: 0 }] })
    expect(await syncMain(git, repo, ['origin'])).toBeNull()
    expect(calls.filter((call) => call === 'fetch origin')).toHaveLength(2)
    expect(calls.filter((call) => call === 'merge --no-edit origin/main')).toHaveLength(2)
  })

  // The other clone pushed after this push read the remote's refs but before the remote updated its ref (BTN-686).
  it.each([
    ' ! [remote rejected] main -> main (incorrect old value provided)\nerror: failed to push some refs',
    ' ! [remote rejected] main -> main (failed to update ref)\nerror: failed to push some refs',
    " ! [remote rejected] main -> main (cannot lock ref 'refs/heads/main': is at 1a2b but expected 3c4d)",
  ])('syncs once more when the remote refused to update its ref: %s', async (out) => {
    const { git, calls } = fakeGit({ ...builtIn, 'push origin main': [{ code: 1, out }, { code: 0 }] })
    expect(await syncMain(git, repo, ['origin'])).toBeNull()
    expect(calls.filter((call) => call === 'fetch origin')).toHaveLength(2)
  })

  it('does not sync again when a hook of the remote declined the push', async () => {
    const out = ' ! [remote rejected] main -> main (pre-receive hook declined)\nerror: failed to push some refs'
    const { git, calls } = fakeGit({ ...builtIn, 'push origin main': [{ code: 1, out }, { code: 0 }] })
    expect(await syncMain(git, repo, ['origin'])).toEqual(notice('sync.push', { remote: 'origin', main: 'main' }, { detail: out }))
    expect(calls.filter((call) => call === 'push origin main')).toHaveLength(1)
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

describe('transientFailure', () => {
  const unreachable = "fatal: unable to access 'https://github.com/john/repo.git/': Failed to connect to github.com port 443 after 21096 ms: Couldn't connect to server"
  const push = (detail: string) => notice('sync.push', { remote: 'origin', main: 'dev' }, { detail })

  it('takes a fetch, a push or the alias that could not reach the remote as the network', () => {
    expect(transientFailure(notice('sync.fetch', { remote: 'github' }, { detail: unreachable }))).toBe('network')
    expect(transientFailure(notice('sync.push', { remote: 'origin', main: 'main' }, { detail: 'fatal: unable to access: Could not resolve host: git.example.com' }))).toBe('network')
    expect(transientFailure(notice('sync.alias', { exit: 1 }, { detail: 'ssh: connect to host git.example.com port 22: Connection timed out' }))).toBe('network')
    expect(transientFailure(notice('sync.fetch', { remote: 'origin' }, { detail: 'error: RPC failed; curl 56 Recv failure: Connection reset by peer' }))).toBe('network')
  })

  it('takes an error of the remote server as the server, not a refusal (BTN-1654)', () => {
    const internal = [
      'remote: Internal Server Error',
      'remote: Request ID 0A1B:2C3D:4E5F:6A7B:8C9D',
      'To https://github.com/john/repo.git',
      ' ! [remote rejected] dev -> dev (Internal Server Error)',
      "error: failed to push some refs to 'https://github.com/john/repo.git'",
    ].join('\n')
    expect(transientFailure(push(internal))).toBe('server')
    expect(transientFailure(notice('sync.alias', { exit: 1 }, { detail: internal }))).toBe('server')
    expect(transientFailure(push(' ! [remote rejected] dev -> dev (Bad Gateway)'))).toBe('server')
    expect(transientFailure(push('remote: Service Unavailable'))).toBe('server')
    expect(transientFailure(push('remote: Gateway Timeout'))).toBe('server')
    expect(transientFailure(notice('sync.fetch', { remote: 'origin' }, { detail: "fatal: unable to access 'https://github.com/john/repo.git/': The requested URL returned error: 502" }))).toBe('server')
    expect(transientFailure(push('error: RPC failed; HTTP 503 curl 22 The requested URL returned error: 503'))).toBe('server')
  })

  it("takes a fetch that met another process's update of a local ref as a race (BTN-1720)", () => {
    const fetch = (detail: string) => notice('sync.fetch', { remote: 'origin' }, { detail })
    const race = 'From https://github.com/john/repo\n   4c596cce..d225f911  dev        -> origin/dev\nerror: fetching ref refs/remotes/origin/dev failed: incorrect old value provided'
    expect(transientFailure(fetch(race))).toBe('race')
    expect(transientFailure(fetch("error: cannot lock ref 'refs/remotes/origin/dev': is at d225f911 but expected 4c596cce"))).toBe('race')
    expect(transientFailure(fetch("error: Unable to create '/repo/.git/refs/remotes/origin/dev.lock': File exists.\nerror: failed to lock ref 'refs/remotes/origin/dev'"))).toBe('race')
    expect(transientFailure(notice('sync.alias', { exit: 1 }, { detail: race }))).toBe('race')
    expect(transientFailure(push(' ! [remote rejected] dev -> dev (cannot lock ref)'))).toBeNull()
    expect(transientFailure(push(' ! [remote rejected] dev -> dev (incorrect old value provided)'))).toBeNull()
  })

  it('leaves a refusal of the remote and anything but a fetch or a push', () => {
    expect(transientFailure(push(rejected.out))).toBeNull()
    expect(transientFailure(push('remote: Permission denied\nfatal: unable to access: The requested URL returned error: 403'))).toBeNull()
    expect(transientFailure(push(' ! [remote rejected] dev -> dev (pre-receive hook declined)\nerror: failed to push some refs'))).toBeNull()
    expect(transientFailure(push('remote: hook: Service Unavailable from the lint service\n ! [remote rejected] dev -> dev (pre-receive hook declined)'))).toBeNull()
    expect(transientFailure(push('remote: error: the commit says Internal Server Error\n ! [remote rejected] dev -> dev (protected branch hook declined)'))).toBeNull()
    expect(transientFailure(notice('sync.merge', { remote: 'origin', main: 'main' }, { detail: 'Failed to connect' }))).toBeNull()
    expect(transientFailure(notice('sync.merge', { remote: 'origin', main: 'main' }, { detail: 'remote: Internal Server Error' }))).toBeNull()
    expect(transientFailure(notice('sync.notMain', { repo, branch: 'abc-7/task', main: 'main' }))).toBeNull()
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

describe('fastForwardTo (BTN-994)', () => {
  const clean = {
    'branch --show-current': { out: 'main' },
    'status --porcelain --untracked-files=no': { out: '' },
    'rev-parse --quiet --verify MERGE_HEAD': { code: 1 },
    remote: { out: 'origin\nmirror' },
  }
  const commit = 'c'.repeat(40)

  it('fetches every remote and fast-forwards main to the commit, not past it', async () => {
    const { git, calls } = fakeGit({ ...clean, 'fetch origin': { code: 128 } })
    expect(await fastForwardTo(git, repo, 'main', commit)).toBe('forwarded')
    expect(calls).toEqual([
      'branch --show-current', 'status --porcelain --untracked-files=no', 'rev-parse --quiet --verify MERGE_HEAD', 'remote', 'fetch origin', 'fetch mirror', `merge --ff-only ${commit}`,
    ])
  })

  it('leaves a checkout off main, with changes to tracked files or in the middle of a merge, and says which', async () => {
    const off = fakeGit({ ...clean, 'branch --show-current': { out: 'abc-7/task' } })
    expect(await fastForwardTo(off.git, repo, 'main', commit)).toBe('offMain')
    const changed = fakeGit({ ...clean, 'status --porcelain --untracked-files=no': { out: ' M a.ts' } })
    expect(await fastForwardTo(changed.git, repo, 'main', commit)).toBe('dirty')
    const merging = fakeGit({ ...clean, 'rev-parse --quiet --verify MERGE_HEAD': { code: 0, out: 'd'.repeat(40) } })
    expect(await fastForwardTo(merging.git, repo, 'main', commit)).toBe('merging')
    expect([...off.calls, ...changed.calls, ...merging.calls].some((call) => call.startsWith('fetch') || call.startsWith('merge'))).toBe(false)
  })

  it('says a main ahead or diverged was not fast-forwarded', async () => {
    const { git } = fakeGit({ ...clean, [`merge --ff-only ${commit}`]: { code: 128, out: 'fatal: Not possible to fast-forward, aborting.' } })
    expect(await fastForwardTo(git, repo, 'main', commit)).toBe('notFastForward')
  })
})
