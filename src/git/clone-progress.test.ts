import { describe, expect, it } from 'vitest'
import { parseHeads, parseProgress, remoteFailure, remoteName, remoteShaped, sameRemote } from './clone-progress.js'

describe('parseProgress', () => {
  it('reads the stage, the percent, the bytes and the speed of a receiving line', () => {
    expect(parseProgress('Receiving objects:  45% (1234/2741), 12.50 MiB | 3.20 MiB/s')).toEqual({
      stage: 'receiving',
      percent: 45,
      bytes: 13107200,
      speed: 3355443,
    })
  })

  it.each([
    ['remote: Counting objects: 100% (12/12), done.', { stage: 'counting', percent: 100 }],
    ['remote: Compressing objects:  50% (3/6)', { stage: 'compressing', percent: 50 }],
    ['Resolving deltas:  10% (27/270)', { stage: 'resolving', percent: 10 }],
    ['Updating files:  73% (730/1000)', { stage: 'files', percent: 73 }],
    ['Filtering content:  40% (2/5), 10.00 KiB | 2.00 KiB/s', { stage: 'lfs', percent: 40, bytes: 10240, speed: 2048 }],
  ])('reads %s', (line, progress) => {
    expect(parseProgress(line)).toEqual(progress)
  })

  it.each(["Cloning into 'storefront'...", 'remote: Total 2741 (delta 0), reused 0 (delta 0)', ''])('takes %j for no progress', (line) => {
    expect(parseProgress(line)).toBeNull()
  })
})

describe('remoteFailure', () => {
  it.each([
    ["fatal: Authentication failed for 'https://example.com/a/b.git/'", 'git.remoteDenied'],
    ['fatal: could not read Username for \'https://example.com\': terminal prompts disabled', 'git.remoteDenied'],
    ['git@example.com: Permission denied (publickey).\nfatal: Could not read from remote repository.', 'git.remoteDenied'],
    ["fatal: unable to access 'https://example.com/a/b.git/': The requested URL returned error: 403", 'git.remoteDenied'],
    ["fatal: unable to access 'https://example.invalid/a/b.git/': Could not resolve host: example.invalid", 'git.remoteNetwork'],
    ['ssh: connect to host example.com port 22: Connection timed out', 'git.remoteNetwork'],
    ['remote: Repository not found.\nfatal: repository \'https://example.com/a/b.git/\' not found', 'git.remoteNotFound'],
    ["fatal: 'D:/none' does not appear to be a git repository", 'git.remoteNotFound'],
    ['fatal: early EOF', 'git.remoteFailed'],
  ])('reads %j as %s', (out, code) => {
    expect(remoteFailure(out, 'https://example.com/a/b.git')).toMatchObject({ code, params: { remote: 'https://example.com/a/b.git' }, detail: out })
  })
})

describe('remoteShaped', () => {
  it.each([
    'https://example.com/owner/storefront.git',
    'ssh://git@example.com:2222/owner/storefront.git',
    'git://example.com/storefront',
    'file:///srv/git/storefront.git',
    'git@example.com:owner/storefront.git',
    'example:owner/storefront',
    '/srv/git/storefront.git',
    'D:\\repos\\my storefront',
    'D:/repos/storefront',
    '\\\\server\\share\\storefront',
  ])('takes %j for an address', (remote) => {
    expect(remoteShaped(remote)).toBe(true)
  })

  it.each([
    'Hello, this is a paragraph pasted by mistake: nothing like an address',
    'https://example.com/owner/my storefront.git',
    'storefront',
    'owner/storefront',
    'C:storefront',
    'git@example.com',
  ])('refuses %j', (remote) => {
    expect(remoteShaped(remote)).toBe(false)
  })
})

describe('parseHeads', () => {
  it('reads the default branch and the branches', () => {
    const out = ['ref: refs/heads/trunk\tHEAD', 'abc123\tHEAD', 'abc123\trefs/heads/trunk', 'def456\trefs/heads/release/v0.2'].join('\n')
    expect(parseHeads(out)).toEqual({ head: 'trunk', branches: ['trunk', 'release/v0.2'] })
  })

  it('has no default branch for an empty repository', () => {
    expect(parseHeads('')).toEqual({ head: null, branches: [] })
  })
})

describe('remoteName', () => {
  it.each([
    ['https://example.com/owner/storefront.git', 'storefront'],
    ['git@example.com:owner/storefront.git', 'storefront'],
    ['https://example.com/owner/storefront/', 'storefront'],
    ['D:\\repos\\storefront', 'storefront'],
    ['ssh://git@example.com:2222/owner/store.front', 'store.front'],
  ])('names %s %s', (remote, name) => {
    expect(remoteName(remote)).toBe(name)
  })
})

describe('sameRemote', () => {
  it('takes the scheme, the user and .git apart', () => {
    expect(sameRemote('git@Example.com:owner/storefront.git', 'https://example.com/owner/storefront')).toBe(true)
    expect(sameRemote('https://example.com/owner/storefront', 'https://example.com/owner/other')).toBe(false)
  })
})
