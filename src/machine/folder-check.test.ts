import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Git, GitResult } from '../git/types.js'
import { NoticeError } from '../notice/notice.js'
import { checkFolderStep, cloneTarget, probeFolder, throwOf, type FolderCheckDeps, type FolderSpec } from './folder-check.js'

const spec: FolderSpec = { project: 'p1', folder: '/work/abc', remotes: ['https://forge.example.com/team/abc.git'], branch: 'trunk', claude: true }

/** git answering by the joined arguments; anything unscripted fails. */
function gitOf(answers: Record<string, GitResult>, calls: string[][] = []): Git {
  return async (_cwd, args) => {
    calls.push(args)
    return answers[args.join(' ')] ?? { code: 1, out: '' }
  }
}

const REMOTES = 'config --get-regexp ^remote\\..*\\.url$'
const ok = (out = ''): GitResult => ({ code: 0, out })

const idle: FolderCheckDeps['packages'] = { installingOf: () => [], unready: () => [], trackerMissing: () => undefined, localStdio: () => [] }

function depsOf(git: Git, extra: Partial<FolderCheckDeps> = {}): FolderCheckDeps {
  return { git, claudeConfigs: () => [], packages: idle, ...extra }
}

describe('checkFolderStep', () => {
  it('repo: no git, no repository, a work tree', async () => {
    expect(await checkFolderStep(depsOf(async () => ({ code: 1, out: '', missing: true })), 'repo', spec)).toMatchObject({ code: 'pool.noGit' })
    expect(await checkFolderStep(depsOf(gitOf({})), 'repo', spec)).toMatchObject({ code: 'pool.notRepository', params: { folder: '/work/abc' } })
    expect(await checkFolderStep(depsOf(gitOf({ 'rev-parse --is-inside-work-tree': ok('true\n') })), 'repo', spec)).toBeNull()
  })

  it('remote: the hub has none, the folder has another, the same one under another scheme', async () => {
    expect(await checkFolderStep(depsOf(gitOf({})), 'remote', { ...spec, remotes: [] })).toMatchObject({ code: 'pool.hubNoRemote' })
    const other = gitOf({ [REMOTES]: ok('remote.origin.url https://forge.example.com/team/other.git\n') })
    expect(await checkFolderStep(depsOf(other), 'remote', spec)).toMatchObject({ code: 'pool.otherRemote', params: { remote: spec.remotes[0] } })
    const same = gitOf({ [REMOTES]: ok('remote.upstream.url git@forge.example.com:team/abc\n') })
    expect(await checkFolderStep(depsOf(same), 'remote', spec)).toBeNull()
  })

  it('with no repository on the hub, the folder\'s own remote is the project\'s: origin first (BTN-1554)', async () => {
    const unknown = { ...spec, remotes: null }
    expect(await checkFolderStep(depsOf(gitOf({})), 'remote', unknown)).toMatchObject({ code: 'pool.folderNoRemote', params: { folder: '/work/abc' } })
    const remotes = { [REMOTES]: ok('remote.backup.url https://forge.example.com/team/copy.git\nremote.origin.url https://forge.example.com/team/abc.git\n') }
    expect(await checkFolderStep(depsOf(gitOf(remotes)), 'remote', unknown)).toBeNull()
    const tracked = gitOf({ ...remotes, 'rev-parse --verify --quiet refs/remotes/origin/trunk': ok('abc\n') })
    expect(await checkFolderStep(depsOf(tracked), 'branch', unknown)).toBeNull()
    const calls: string[][] = []
    const pushed = gitOf({ ...remotes, 'rev-parse --verify --quiet refs/remotes/origin/trunk': ok('abc\n'), 'push --dry-run --porcelain origin refs/remotes/origin/trunk:refs/heads/trunk': ok() }, calls)
    expect(await checkFolderStep(depsOf(pushed), 'push', unknown)).toBeNull()
    expect(await checkFolderStep(depsOf(gitOf({})), 'push', unknown)).toMatchObject({ code: 'pool.folderNoRemote' })
    expect(await checkFolderStep(depsOf(gitOf({})), 'push', { ...spec, remotes: [] })).toMatchObject({ code: 'pool.hubNoRemote' })
  })

  it('branch: a local or a remote-tracking branch of the project remote passes', async () => {
    const remotes = { [REMOTES]: ok('remote.up.url https://forge.example.com/team/abc\n') }
    expect(await checkFolderStep(depsOf(gitOf(remotes)), 'branch', spec)).toMatchObject({ code: 'pool.noBranch', params: { branch: 'trunk' } })
    const tracked = gitOf({ ...remotes, 'rev-parse --verify --quiet refs/remotes/up/trunk': ok('abc\n') })
    expect(await checkFolderStep(depsOf(tracked), 'branch', spec)).toBeNull()
    const local = gitOf({ 'rev-parse --verify --quiet refs/heads/trunk': ok('abc\n') })
    expect(await checkFolderStep(depsOf(local), 'branch', spec)).toBeNull()
  })

  describe('trust', () => {
    let root: string | undefined
    afterEach(() => {
      if (root !== undefined) rmSync(root, { recursive: true, force: true })
      root = undefined
    })

    it('needs a trusted folder only for Claude Code', async () => {
      root = mkdtempSync(join(tmpdir(), 'folder-check-'))
      const folder = realpathSync.native(root)
      const key = folder.replaceAll('\\', '/')
      const trusted = depsOf(gitOf({}), { claudeConfigs: () => [undefined, { projects: { [key]: { hasTrustDialogAccepted: true } } }] })
      expect(await checkFolderStep(trusted, 'trust', { ...spec, folder })).toBeNull()
      const untrusted = depsOf(gitOf({}), { claudeConfigs: () => [{ projects: {} }] })
      expect(await checkFolderStep(untrusted, 'trust', { ...spec, folder })).toMatchObject({ code: 'pool.untrusted' })
      expect(await checkFolderStep(untrusted, 'trust', { ...spec, folder, claude: false })).toBeNull()
    })
  })

  it('packages: waits for an installation, then names what is not ready', async () => {
    let installing = ['huly']
    const waits: number[] = []
    const packages = { ...idle, installingOf: () => installing }
    const wait = async (ms: number) => {
      waits.push(ms)
      installing = []
    }
    expect(await checkFolderStep(depsOf(gitOf({}), { packages, wait }), 'packages', spec)).toBeNull()
    expect(waits).toHaveLength(1)
    const stuck = { ...idle, installingOf: () => ['huly'] }
    expect(await checkFolderStep(depsOf(gitOf({}), { packages: stuck, wait: async () => {}, packagesWaitMs: 0 }), 'packages', spec))
      .toMatchObject({ code: 'pool.packagesInstalling', params: { names: 'huly' } })
    const unready = { ...idle, unready: () => ['github', 'huly'] }
    expect(await checkFolderStep(depsOf(gitOf({}), { packages: unready }), 'packages', spec)).toMatchObject({ code: 'pool.packagesUnready', params: { names: 'github, huly' } })
  })

  it("packages: names the tracker's server no package brings, rather than letting a blocked set pass (BTN-1299)", async () => {
    const packages = { ...idle, trackerMissing: () => 'tasks' }
    expect(await checkFolderStep(depsOf(gitOf({}), { packages }), 'packages', spec)).toMatchObject({ code: 'pool.packagesNoTracker', params: { server: 'tasks' } })
  })

  it('packages: names a stdio server whose command the machine does not have (BTN-994)', async () => {
    const servers = [
      { package: 'files', server: 'files', command: '/opt/example/bin/files-mcp', args: [] },
      { package: 'browser', server: 'playwright', command: 'node', args: ['/x/cli.js'] },
    ]
    const packages = { ...idle, localStdio: () => servers }
    const found = (command: string) => command === 'node'
    expect(await checkFolderStep(depsOf(gitOf({}), { packages, found }), 'packages', spec)).toMatchObject({
      code: 'pool.serverMissing',
      params: { names: 'files/files (/opt/example/bin/files-mcp)' },
    })
    expect(await checkFolderStep(depsOf(gitOf({}), { packages, found: () => true }), 'packages', spec)).toBeNull()
  })

  it('push: a dry run of the main branch onto itself, refused with git\'s answer', async () => {
    const calls: string[][] = []
    const remotes = { [REMOTES]: ok('remote.origin.url https://forge.example.com/team/abc.git\n'), 'rev-parse --verify --quiet refs/remotes/origin/trunk': ok('abc\n') }
    const pushed = gitOf({ ...remotes, 'push --dry-run --porcelain origin refs/remotes/origin/trunk:refs/heads/trunk': ok() }, calls)
    expect(await checkFolderStep(depsOf(pushed), 'push', spec)).toBeNull()
    expect(calls.at(-1)).toEqual(['push', '--dry-run', '--porcelain', 'origin', 'refs/remotes/origin/trunk:refs/heads/trunk'])
    const refused = gitOf({ [REMOTES]: remotes[REMOTES]!, 'push --dry-run --porcelain origin refs/heads/trunk:refs/heads/trunk': { code: 128, out: 'denied\n' } })
    expect(await checkFolderStep(depsOf(refused), 'push', spec)).toMatchObject({ code: 'pool.noPush', params: { remote: 'https://forge.example.com/team/abc.git' }, detail: 'denied' })
  })

  it('push: a remote branch gone ahead of the folder is a refusal by history, not of the right (BTN-1513)', async () => {
    const remotes = { [REMOTES]: ok('remote.origin.url https://forge.example.com/team/abc.git\n'), 'rev-parse --verify --quiet refs/remotes/origin/trunk': ok('abc\n') }
    const answer = (reason: string): GitResult => ({
      code: 1,
      out: `To https://forge.example.com/team/abc.git\n!\trefs/remotes/origin/trunk:refs/heads/trunk\t[rejected] (${reason})\nDone\nerror: failed to push some refs to 'https://forge.example.com/team/abc.git'`,
    })
    const key = 'push --dry-run --porcelain origin refs/remotes/origin/trunk:refs/heads/trunk'
    expect(await checkFolderStep(depsOf(gitOf({ ...remotes, [key]: answer('fetch first') })), 'push', spec)).toBeNull()
    expect(await checkFolderStep(depsOf(gitOf({ ...remotes, [key]: answer('non-fast-forward') })), 'push', spec)).toBeNull()
    const declined: GitResult = { code: 1, out: 'To https://forge.example.com/team/abc.git\n!\trefs/remotes/origin/trunk:refs/heads/trunk\t[remote rejected] (protected branch hook declined)\nDone' }
    expect(await checkFolderStep(depsOf(gitOf({ ...remotes, [key]: declined })), 'push', spec)).toMatchObject({ code: 'pool.noPush' })
  })
})

describe('cloneTarget', () => {
  it('takes an absent or empty folder only', () => {
    const root = mkdtempSync(join(tmpdir(), 'clone-target-'))
    try {
      expect(() => cloneTarget(join(root, 'absent'))).not.toThrow()
      mkdirSync(join(root, 'empty'))
      expect(() => cloneTarget(join(root, 'empty'))).not.toThrow()
      writeFileSync(join(root, 'empty', 'file'), 'x')
      expect(() => cloneTarget(join(root, 'empty'))).toThrow(NoticeError)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('probeFolder', () => {
  const remotes = ['https://forge.example.com/team/abc.git']

  it('free: absent or empty; a clone of the remote; anything else refused with what to do (BTN-1297)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'probe-folder-'))
    try {
      expect(await probeFolder(gitOf({}), join(root, 'absent'), remotes)).toEqual({ state: 'free' })
      mkdirSync(join(root, 'empty'))
      expect(await probeFolder(gitOf({}), join(root, 'empty'), remotes)).toEqual({ state: 'free' })
      const filled = join(root, 'filled')
      mkdirSync(filled)
      writeFileSync(join(filled, 'file'), 'x')
      expect(await probeFolder(gitOf({}), filled, remotes)).toEqual({ state: 'taken', notice: { code: 'pool.folderNotEmpty', params: { folder: filled } } })
      const repo = { 'rev-parse --is-inside-work-tree': ok('true\n') }
      const same = gitOf({ ...repo, [REMOTES]: ok('remote.origin.url git@forge.example.com:team/abc\n') })
      expect(await probeFolder(same, filled, remotes)).toEqual({ state: 'clone' })
      const other = gitOf({ ...repo, [REMOTES]: ok('remote.origin.url https://forge.example.com/team/other.git\n') })
      expect(await probeFolder(other, filled, remotes)).toEqual({ state: 'taken', notice: { code: 'pool.foreignRepo', params: { folder: filled, remote: remotes[0] } } })
      expect(await probeFolder(async () => ({ code: 1, out: '', missing: true }), filled, remotes)).toMatchObject({ state: 'taken', notice: { code: 'pool.noGit' } })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('with no repository on the hub, a clone with a remote is taken as it is, with a note; no remote list is ever blank (BTN-1554)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'probe-folder-'))
    try {
      const filled = join(root, 'filled')
      mkdirSync(filled)
      writeFileSync(join(filled, 'file'), 'x')
      const repo = { 'rev-parse --is-inside-work-tree': ok('true\n') }
      const any = gitOf({ ...repo, [REMOTES]: ok('remote.origin.url https://forge.example.com/team/other.git\n') })
      expect(await probeFolder(any, filled, null)).toEqual({ state: 'clone', notice: { code: 'pool.hubNoRepositoryTaken', params: { folder: filled } } })
      expect(await probeFolder(gitOf(repo), filled, null)).toEqual({ state: 'taken', notice: { code: 'pool.folderNoRemote', params: { folder: filled } } })
      expect(await probeFolder(gitOf({}), join(root, 'absent'), null)).toEqual({ state: 'free' })
      expect(await probeFolder(any, filled, [])).toEqual({ state: 'taken', notice: { code: 'pool.hubNoRemote', params: {} } })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('throwOf', () => {
  it('throws a refusal and passes null', () => {
    expect(() => throwOf(null)).not.toThrow()
    expect(() => throwOf({ code: 'pool.noGit', params: {} })).toThrow(NoticeError)
  })
})
