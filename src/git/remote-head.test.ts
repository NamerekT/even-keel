import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { remoteHead } from './remote-head.js'
import type { Git, GitResult } from './types.js'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'remote-head-'))
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

function counting(answer: GitResult = { code: 0, out: `${'c'.repeat(40)}\n` }) {
  const calls: string[][] = []
  const git: Git = async (_cwd, args) => {
    calls.push(args)
    return answer
  }
  return { git, calls }
}

function checkout(name = 'app'): string {
  const repo = join(root, name)
  mkdirSync(join(repo, '.git', 'refs', 'remotes'), { recursive: true })
  writeFileSync(join(repo, '.git', 'config'), '[core]\n')
  return repo
}

function loose(repo: string, ref: string, sha: string): void {
  const file = join(repo, '.git', ref)
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, `${sha}\n`)
}

describe('remoteHead', () => {
  it('reads a loose ref without git', async () => {
    const repo = checkout()
    loose(repo, 'refs/remotes/origin/main', A)
    const { git, calls } = counting()
    expect(await remoteHead(git, repo, 'origin', 'main')).toBe(A)
    expect(calls).toEqual([])
  })

  it('reads a ref from packed-refs, skipping comments and peeled lines', async () => {
    const repo = checkout()
    writeFileSync(join(repo, '.git', 'packed-refs'), `# pack-refs with: peeled fully-peeled sorted \n${B} refs/remotes/origin/dev\n${A} refs/remotes/origin/main\n^${B}\n`)
    const { git, calls } = counting()
    expect(await remoteHead(git, repo, 'origin', 'main')).toBe(A)
    expect(calls).toEqual([])
  })

  it('takes the loose ref over the packed one, and the packed one once the loose is gone', async () => {
    const repo = checkout()
    writeFileSync(join(repo, '.git', 'packed-refs'), `${A} refs/remotes/origin/main\n`)
    loose(repo, 'refs/remotes/origin/main', B)
    const { git } = counting()
    expect(await remoteHead(git, repo, 'origin', 'main')).toBe(B)
    unlinkSync(join(repo, '.git', 'refs', 'remotes', 'origin', 'main'))
    expect(await remoteHead(git, repo, 'origin', 'main')).toBe(A)
  })

  it('sees packed-refs rewritten', async () => {
    const repo = checkout()
    writeFileSync(join(repo, '.git', 'packed-refs'), `${A} refs/remotes/origin/main\n`)
    const { git } = counting()
    expect(await remoteHead(git, repo, 'origin', 'main')).toBe(A)
    writeFileSync(join(repo, '.git', 'packed-refs'), `${B} refs/remotes/origin/main\n# longer\n`)
    expect(await remoteHead(git, repo, 'origin', 'main')).toBe(B)
  })

  it('is null for a ref in neither place', async () => {
    const repo = checkout()
    const { git, calls } = counting()
    expect(await remoteHead(git, repo, 'origin', 'main')).toBeNull()
    expect(calls).toEqual([])
  })

  it('reads the common folder of a linked worktree', async () => {
    const main = checkout()
    loose(main, 'refs/remotes/origin/main', A)
    const gitDir = join(main, '.git', 'worktrees', 'task')
    mkdirSync(gitDir, { recursive: true })
    writeFileSync(join(gitDir, 'commondir'), '../..\n')
    const worktree = join(root, 'task')
    mkdirSync(worktree)
    writeFileSync(join(worktree, '.git'), `gitdir: ${gitDir}\n`)
    const { git, calls } = counting()
    expect(await remoteHead(git, worktree, 'origin', 'main')).toBe(A)
    expect(calls).toEqual([])
  })

  it('asks git for a folder without its own .git, a reftable store or a symbolic ref', async () => {
    const plain = join(root, 'plain')
    mkdirSync(plain)
    const reftable = checkout('reftable')
    mkdirSync(join(reftable, '.git', 'reftable'))
    const symbolic = checkout('symbolic')
    loose(symbolic, 'refs/remotes/origin/main', 'ref: refs/remotes/origin/dev')
    for (const repo of [plain, reftable, symbolic]) {
      const { git, calls } = counting()
      expect(await remoteHead(git, repo, 'origin', 'main')).toBe('c'.repeat(40))
      expect(calls).toEqual([['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main']])
    }
  })

  it('is null when git does not know the ref', async () => {
    const { git } = counting({ code: 1, out: '' })
    expect(await remoteHead(git, join(root, 'none'), 'origin', 'main')).toBeNull()
  })
})
