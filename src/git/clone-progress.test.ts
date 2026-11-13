import { describe, expect, it } from 'vitest'
import { cloneFailure, parseHeads, parseProgress, remoteFailure, remoteName, remoteShaped, sameRemote } from './clone-progress.js'

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

  it.each([
    ["Cloning into 'storefront'...", { stage: 'connecting' }],
    ["Cloning into bare repository 'storefront.git'...", { stage: 'connecting' }],
    ['remote: Enumerating objects: 1234567', { stage: 'enumerating', objects: 1234567 }],
    ['remote: Enumerating objects: 1234567, done.', { stage: 'enumerating', objects: 1234567 }],
    ['remote: Counting objects: 2741, done.', { stage: 'enumerating', objects: 2741 }],
  ])('reads the stage before the first percent of %s', (line, progress) => {
    expect(parseProgress(line)).toEqual(progress)
  })

  it.each(['remote: Total 2741 (delta 0), reused 0 (delta 0)', 'warning: redirecting to https://example.com/a.git/', ''])('takes %j for no progress', (line) => {
    expect(parseProgress(line)).toBeNull()
  })
})

describe('remoteFailure', () => {
  it.each([
    ["fatal: Authentication failed for 'https://example.com/a/b.git/'", 'git.remoteDenied'],
    ['fatal: could not read Username for \'https://example.com\': terminal prompts disabled', 'git.remoteDenied'],
    ["fatal: unable to access 'https://example.com/a/b.git/': The requested URL returned error: 403", 'git.remoteDenied'],
    ["fatal: unable to access 'https://example.invalid/a/b.git/': Could not resolve host: example.invalid", 'git.remoteNetwork'],
    ['ssh: connect to host example.com port 22: Connection timed out', 'git.remoteNetwork'],
    ['remote: Repository not found.\nfatal: repository \'https://example.com/a/b.git/\' not found', 'git.remoteDenied'],
    ["fatal: 'D:/none' does not appear to be a git repository", 'git.remoteNotFound'],
    ['fatal: early EOF', 'git.remoteNetwork'],
    ['error: RPC failed; curl 18 transfer closed with outstanding read data remaining', 'git.remoteNetwork'],
    ['error: RPC failed; curl 28 Operation too slow. Less than 1000 bytes/sec transferred the last 30 seconds', 'git.remoteNetwork'],
    ['error: RPC failed; curl 56 Recv failure: Connection was reset', 'git.remoteNetwork'],
    ['fetch-pack: unexpected disconnect while reading sideband packet', 'git.remoteNetwork'],
    ['fatal: the remote end hung up unexpectedly', 'git.remoteNetwork'],
    ['fatal: unable to checkout working tree', 'git.remoteFailed'],
  ])('reads %j as %s', (out, code) => {
    expect(remoteFailure(out, 'https://example.com/a/b.git')).toMatchObject({ code, params: { remote: 'https://example.com/a/b.git' }, detail: out })
  })

  const SSH_TAIL = '\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.\n'

  it('reads an unknown SSH host key as its own notice with the command that learns it', () => {
    const out = `Host key verification failed.\r${SSH_TAIL}`
    expect(remoteFailure(out, 'git@example.com:owner/storefront.git')).toEqual({
      code: 'git.remoteHostKey',
      params: { remote: 'git@example.com:owner/storefront.git', command: 'ssh -T git@example.com' },
      detail: out,
    })
  })

  it.each([
    ['ssh://git@example.com:2222/owner/storefront.git', 'ssh -T -p 2222 git@example.com'],
    ['ssh://example.com/owner/storefront.git', 'ssh -T example.com'],
    ['git+ssh://deploy@git.example.com/storefront', 'ssh -T deploy@git.example.com'],
    ['example:owner/storefront', 'ssh -T example'],
  ])('learns the host key of %s with %s', (remote, command) => {
    expect(remoteFailure(`Host key verification failed.${SSH_TAIL}`, remote).params).toEqual({ remote, command })
  })

  it.each([
    `git@example.com: Permission denied (publickey).${SSH_TAIL}`,
    `git@example.com: Permission denied (publickey,password).${SSH_TAIL}`,
  ])('reads an SSH refusal of the key %j as no SSH key', (out) => {
    expect(remoteFailure(out, 'git@example.com:owner/storefront.git')).toMatchObject({ code: 'git.remoteSshKey', params: { remote: 'git@example.com:owner/storefront.git' } })
  })

  it('reads "repository not found" over HTTPS as no access: a private repository answers so to a git not signed in', () => {
    const out = "remote: Repository not found.\nfatal: repository 'https://example.com/owner/private.git/' not found\n"
    expect(remoteFailure(out, 'https://example.com/owner/private.git').code).toBe('git.remoteDenied')
  })

  it('keeps "not found" of an SSH or local remote as no repository', () => {
    expect(remoteFailure(`ERROR: Repository not found.${SSH_TAIL}`, 'git@example.com:owner/none.git').code).toBe('git.remoteNotFound')
    expect(remoteFailure("fatal: repository 'D:/none' does not exist\n", 'D:/none').code).toBe('git.remoteNotFound')
  })
})

// What git printed when the network went down at 10% of a large clone (BTN-1100, a live check in Windows Sandbox).
const BROKEN_LINES = [
  "Cloning into 'C:\\Projects\\git\\even-keel\\projects\\vscode'...",
  'remote: Enumerating objects: 2604670',
  'remote: Enumerating objects: 2613044, done.',
  'error: RPC failed; curl 56 Recv failure: Connection was reset',
  'error: 43086 bytes of body are still expected',
  'fetch-pack: unexpected disconnect while reading sideband packet',
  'fatal: early EOF',
  'fatal: fetch-pack: invalid index-pack output',
]
const BROKEN_REASON = BROKEN_LINES.slice(3).join('\n')
const VSCODE = 'https://github.com/microsoft/vscode.git'

describe('cloneFailure', () => {
  it("keeps git's lines before the first percent out of the reason: they are progress, not why it failed", () => {
    expect(BROKEN_LINES.slice(0, 3).map((line) => parseProgress(line))).not.toContain(null)
    expect(BROKEN_LINES.slice(3).map((line) => parseProgress(line))).toEqual([null, null, null, null, null])
  })

  it('reads the network breaking off after the server answered as a broken clone, with the percent received', () => {
    expect(cloneFailure(BROKEN_REASON, VSCODE, { answered: true, percent: 10 })).toEqual({
      code: 'git.cloneBroken',
      params: { percent: 10 },
      detail: BROKEN_REASON,
    })
  })

  it('has no percent where nothing was received yet', () => {
    expect(cloneFailure(BROKEN_REASON, VSCODE, { answered: true })).toEqual({ code: 'git.cloneBroken', params: {}, detail: BROKEN_REASON })
  })

  it('reads a network failure before the server answered as an unreachable remote', () => {
    expect(cloneFailure(BROKEN_REASON, VSCODE, { answered: false }).code).toBe('git.remoteNetwork')
  })

  it('keeps a refusal that is not the network as it is, whatever was received', () => {
    const out = "fatal: Authentication failed for 'https://example.com/a/b.git/'"
    expect(cloneFailure(out, 'https://example.com/a/b.git', { answered: true, percent: 40 }).code).toBe('git.remoteDenied')
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
