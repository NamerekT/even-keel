import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Git, GitResult } from '../git/types.js'
import { NoticeError } from '../notice/notice.js'
import { checkFolderStep, cloneTarget, throwOf, type FolderCheckDeps, type FolderSpec } from './folder-check.js'

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

function depsOf(git: Git, extra: Partial<FolderCheckDeps> = {}): FolderCheckDeps {
  return { git, claudeConfigs: () => [], packages: { installingOf: () => [], unready: () => [] }, ...extra }
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
    const packages = { installingOf: () => installing, unready: () => [] as string[] }
    const wait = async (ms: number) => {
      waits.push(ms)
      installing = []
    }
    expect(await checkFolderStep(depsOf(gitOf({}), { packages, wait }), 'packages', spec)).toBeNull()
    expect(waits).toHaveLength(1)
    const stuck = { installingOf: () => ['huly'], unready: () => [] as string[] }
    expect(await checkFolderStep(depsOf(gitOf({}), { packages: stuck, wait: async () => {}, packagesWaitMs: 0 }), 'packages', spec))
      .toMatchObject({ code: 'pool.packagesInstalling', params: { names: 'huly' } })
    const unready = { installingOf: () => [], unready: () => ['github', 'huly'] }
    expect(await checkFolderStep(depsOf(gitOf({}), { packages: unready }), 'packages', spec)).toMatchObject({ code: 'pool.packagesUnready', params: { names: 'github, huly' } })
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

describe('throwOf', () => {
  it('throws a refusal and passes null', () => {
    expect(() => throwOf(null)).not.toThrow()
    expect(() => throwOf({ code: 'pool.noGit', params: {} })).toThrow(NoticeError)
  })
})
