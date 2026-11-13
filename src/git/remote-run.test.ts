import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { CloneProgress } from './clone-progress.js'
import { cloner, remoteEnv, remoteReader, restorer, runRemoteGit, type RemoteGit } from './remote-run.js'
import { runGit } from './run.js'

describe('runRemoteGit', { timeout: 60_000 }, () => {
  it('keeps the whole answer of a remote with thousands of branches: its default branch comes first', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'even-keel-remote-'))
    try {
      const git = async (...args: string[]) => {
        const result = await runGit(repo, args)
        if (result.code !== 0) throw new Error(`git ${args.join(' ')}: ${result.out}`)
        return result.out.trim()
      }
      await git('init', '-q', '--template=', '-b', 'main')
      await git('-c', 'user.email=john.doe@example.com', '-c', 'user.name=John Doe', 'commit', '-q', '--allow-empty', '-m', 'base')
      const sha = await git('rev-parse', 'HEAD')
      const names = Array.from({ length: 3000 }, (_, index) => `feature/branch-${String(index).padStart(4, '0')}`)
      writeFileSync(join(repo, '.git', 'packed-refs'), `# pack-refs with: peeled fully-peeled sorted \n${names.map((name) => `${sha} refs/heads/${name}\n`).join('')}`)
      const heads = await remoteReader(runRemoteGit)(repo)
      expect(heads).toEqual({ head: 'main', branches: [...names, 'main'] })
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })
})

describe('remoteEnv', () => {
  it('asks nobody and has git speak English, the words its refusals are read by', () => {
    expect(remoteEnv({ LANG: 'ru_RU.UTF-8', PATH: '/bin' })).toEqual({
      LANG: 'ru_RU.UTF-8',
      PATH: '/bin',
      LC_ALL: 'C',
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'never',
    })
  })
})

describe('remoteReader', () => {
  it('refuses a text that is no git address without asking git', async () => {
    const git = vi.fn<RemoteGit>()
    const read = remoteReader(git)
    expect(await read('a paragraph pasted by mistake')).toMatchObject({ code: 'git.remoteShape', params: {} })
    expect(git).not.toHaveBeenCalled()
  })

  it('asks git for an address', async () => {
    const git = vi.fn<RemoteGit>(async () => ({ code: 0, out: 'ref: refs/heads/trunk\tHEAD\nabc\trefs/heads/trunk' }))
    expect(await remoteReader(git)('https://example.com/owner/storefront.git')).toEqual({ head: 'trunk', branches: ['trunk'] })
  })
})

describe('cloner', () => {
  const REMOTE = 'https://example.com/owner/storefront.git'
  const BROKEN = 'error: RPC failed; curl 56 Recv failure: Connection was reset\nfatal: early EOF'
  const cloneWith = (lines: string[]) =>
    cloner(async (_args, options) => {
      for (const line of lines) options?.onLine?.(line)
      return { code: 128, out: BROKEN }
    })({ remote: REMOTE, path: 'storefront', branch: null, signal: new AbortController().signal, onProgress: () => {} })

  it('names the percent received when the network breaks off halfway', async () => {
    const lines = ["Cloning into 'storefront'...", 'remote: Enumerating objects: 2741, done.', 'Receiving objects:   9% (247/2741)', 'Receiving objects:  10% (275/2741)']
    await expect(cloneWith(lines)).rejects.toMatchObject({ notice: { code: 'git.cloneBroken', params: { percent: 10 }, detail: BROKEN } })
  })

  it('reads the network failing before the server answered as an unreachable remote', async () => {
    await expect(cloneWith(["Cloning into 'storefront'..."])).rejects.toMatchObject({ notice: { code: 'git.remoteNetwork' } })
  })
})

describe('restorer', () => {
  const REMOTE = 'https://example.com/owner/storefront.git'
  const request = (onProgress: (progress: CloneProgress) => void = () => {}) => ({ remote: REMOTE, path: 'D:\\work\\storefront', signal: new AbortController().signal, onProgress })

  it("writes the clone's files out again from HEAD, the index too, reporting the LFS progress", async () => {
    const seen: CloneProgress[] = []
    const git = vi.fn<RemoteGit>(async (_args, options) => {
      options?.onLine?.('Filtering content:  50% (1/2), 300.00 KiB | 300.00 KiB/s')
      return { code: 0, out: '' }
    })
    await restorer(git)(request((progress) => seen.push(progress)))
    expect(git.mock.calls[0]![0]).toEqual(['-C', 'D:\\work\\storefront', 'restore', '--progress', '--source=HEAD', '--staged', '--worktree', ':/'])
    expect(seen).toEqual([expect.objectContaining({ stage: 'lfs', percent: 50 })])
  })

  it('reads an LFS object still missing as that file missing', async () => {
    const out = 'Error downloading object: a.bin (51657d9): Smudge error: Error downloading a.bin (51657d95): [51657d95] Not Found: [404] Not Found\nfatal: a.bin: smudge filter lfs failed'
    await expect(restorer(async () => ({ code: 128, out }))(request())).rejects.toMatchObject({ notice: { code: 'git.lfsMissing', params: { path: 'a.bin' } } })
  })
})
