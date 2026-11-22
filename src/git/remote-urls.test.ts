import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { remoteUrls, REMOTE_URLS_ARGS } from './remote-urls.js'
import type { Git, GitResult } from './types.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'remote-urls-'))
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

function counting(answer: () => GitResult = () => ({ code: 0, out: 'remote.origin.url https://git.example.com/john/app.git' })) {
  const calls: Array<[string, string[]]> = []
  const git: Git = async (cwd, args) => {
    calls.push([cwd, args])
    return answer()
  }
  return { git, calls }
}

function checkout(name: string, config = '[core]\n'): string {
  const repo = join(root, name)
  mkdirSync(join(repo, '.git'), { recursive: true })
  writeFileSync(join(repo, '.git', 'config'), config)
  return repo
}

describe('remoteUrls', () => {
  it('asks git once while the config stays the same', async () => {
    const repo = checkout('app')
    const { git, calls } = counting()
    expect((await remoteUrls(git, repo)).out).toBe('remote.origin.url https://git.example.com/john/app.git')
    await remoteUrls(git, repo)
    await Promise.all([remoteUrls(git, repo), remoteUrls(git, repo)])
    expect(calls).toEqual([[repo, REMOTE_URLS_ARGS]])
  })

  it('asks again once the config changes', async () => {
    const repo = checkout('app')
    const { git, calls } = counting()
    await remoteUrls(git, repo)
    writeFileSync(join(repo, '.git', 'config'), '[core]\n[remote "origin"]\n\turl = https://git.example.com/john/app.git\n')
    await remoteUrls(git, repo)
    expect(calls).toHaveLength(2)
  })

  it('watches the main config from a linked worktree', async () => {
    const main = checkout('app')
    const gitDir = join(main, '.git', 'worktrees', 'task')
    mkdirSync(gitDir, { recursive: true })
    writeFileSync(join(gitDir, 'commondir'), '../..\n')
    const worktree = join(root, 'task')
    mkdirSync(worktree)
    writeFileSync(join(worktree, '.git'), `gitdir: ${gitDir}\n`)
    const { git, calls } = counting()
    await remoteUrls(git, worktree)
    await remoteUrls(git, worktree)
    expect(calls).toHaveLength(1)
    writeFileSync(join(main, '.git', 'config'), '[core]\n\tbare = false\n')
    await remoteUrls(git, worktree)
    expect(calls).toHaveLength(2)
  })

  it('keeps "no remote" but asks again after a failure', async () => {
    const repo = checkout('app')
    let code = 1
    const { git, calls } = counting(() => ({ code, out: '' }))
    await remoteUrls(git, repo)
    await remoteUrls(git, repo)
    expect(calls).toHaveLength(1)
    writeFileSync(join(repo, '.git', 'config'), '[core]\n\tbare = false\n')
    code = 128
    await remoteUrls(git, repo)
    await remoteUrls(git, repo)
    expect(calls).toHaveLength(3)
  })

  it('asks git every time in a folder without a .git of its own', async () => {
    const folder = join(root, 'plain')
    mkdirSync(folder)
    const { git, calls } = counting()
    await remoteUrls(git, folder)
    await remoteUrls(git, join(root, 'missing'))
    await remoteUrls(git, folder)
    expect(calls).toHaveLength(3)
  })

  it('keeps a cache per git runner', async () => {
    const repo = checkout('app')
    const first = counting()
    const second = counting(() => ({ code: 0, out: 'remote.github.url https://github.com/john/app.git' }))
    await remoteUrls(first.git, repo)
    expect((await remoteUrls(second.git, repo)).out).toBe('remote.github.url https://github.com/john/app.git')
    expect([first.calls.length, second.calls.length]).toEqual([1, 1])
  })
})
