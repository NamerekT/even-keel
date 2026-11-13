import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { remoteEnv, remoteReader, runRemoteGit, type RemoteGit } from './remote-run.js'
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
