import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runGit } from './run.js'
import { syncMain, type MergeCheck } from './sync.js'
import { copyRepository } from './template.fixture.js'
import type { GitResult } from './types.js'

// The main branch is not called `main`: the user's global `git sync` alias, written for main, would take the sync.
const MAIN = 'trunk'

let root: string
let remote: string
let first: string
let second: string

const git = async (cwd: string, ...args: string[]) => {
  const result = await runGit(cwd, args)
  if (result.code !== 0) throw new Error(`git ${args.join(' ')}: ${result.out}`)
  return result.out.trim()
}

const commit = async (repo: string, name: string) => {
  writeFileSync(join(repo, name), name)
  await git(repo, 'add', name)
  await git(repo, 'commit', '-q', '-m', name)
}

const clone = async (root: string, name: string) => {
  const path = join(root, name)
  await git(root, 'clone', '-q', join(root, 'remote.git'), path)
  await git(path, 'config', 'user.email', 'john.doe@example.com')
  await git(path, 'config', 'user.name', 'John Doe')
  await git(path, 'config', 'core.hooksPath', join(root, 'no-hooks'))
  return path
}

/** A bare remote with a first commit on the main branch and two clones of it. */
async function remoteAndClones(root: string): Promise<void> {
  await git(root, 'init', '-q', '--bare', '-b', MAIN, join(root, 'remote.git'))
  const path = await clone(root, 'first')
  await git(path, 'checkout', '-q', '-b', MAIN)
  await commit(path, 'base')
  await git(path, 'push', '-q', 'origin', MAIN)
  await clone(root, 'second')
}

const passing = (): MergeCheck & { runs: number } => {
  const check = { runs: 0, run: async () => (check.runs++, null) }
  return check
}

describe('syncMain with a merge check (BTN-995)', { timeout: 60_000 }, () => {
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'even-keel-sync-check-'))
    await copyRepository('sync-check', root, remoteAndClones)
    remote = join(root, 'remote.git')
    first = join(root, 'first')
    second = join(root, 'second')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('runs the check on a merge with commits another clone pushed, then pushes', async () => {
    await commit(first, 'one')
    await git(first, 'push', '-q', 'origin', MAIN)
    await commit(second, 'two')
    const check = passing()

    expect(await syncMain(runGit, second, ['origin'], MAIN, check)).toBeNull()

    expect(check.runs).toBe(1)
    expect(await git(second, 'rev-parse', MAIN)).toBe(await git(remote, 'rev-parse', MAIN))
    expect(await git(remote, 'log', '--format=%s', MAIN)).toContain('two')
  })

  it('does not run the check when main only goes ahead of the remote', async () => {
    await commit(second, 'two')
    const check = passing()

    expect(await syncMain(runGit, second, ['origin'], MAIN, check)).toBeNull()

    expect(check.runs).toBe(0)
    expect(await git(remote, 'log', '--format=%s', MAIN)).toContain('two')
  })

  it('a red check puts main back where it was and pushes nothing', async () => {
    await commit(first, 'one')
    await git(first, 'push', '-q', 'origin', MAIN)
    await commit(second, 'two')
    const before = await git(second, 'rev-parse', MAIN)
    const pushed = await git(remote, 'rev-parse', MAIN)
    const check: MergeCheck = { run: async () => ({ command: 'npm test', code: 1, output: 'one failed' }) }

    const failure = await syncMain(runGit, second, ['origin'], MAIN, check)

    expect(failure).toMatchObject({ code: 'sync.checkRed', params: { main: MAIN, command: 'npm test', code: 1 }, detail: 'one failed' })
    expect(await git(second, 'rev-parse', MAIN)).toBe(before)
    expect(await git(remote, 'rev-parse', MAIN)).toBe(pushed)
  })
})

describe('syncMain with a merge check, pushes rejected (BTN-995)', () => {
  const rejected = { code: 1, out: ' ! [rejected]        trunk -> trunk (fetch first)' }

  function fakeGit(push: Partial<GitResult>[]) {
    const calls: string[] = []
    const git = async (_cwd: string, args: string[]): Promise<GitResult> => {
      const command = args.join(' ')
      calls.push(command)
      if (command === 'config --local --get alias.sync') return { code: 1, out: '' }
      if (command === 'branch --show-current') return { code: 0, out: MAIN }
      if (command.startsWith('merge-base --is-ancestor')) return { code: 1, out: '' }
      if (command.startsWith('push')) return { code: 0, out: '', ...(push.length > 1 ? push.shift() : push[0]) }
      return { code: 0, out: 'abc' }
    }
    return { git, calls }
  }

  it('fetches, merges and checks again after each rejected push, twice at most', async () => {
    const { git, calls } = fakeGit([rejected])
    const check = passing()

    const failure = await syncMain(git, '/home/john/repo', ['origin'], MAIN, check)

    expect(failure).toMatchObject({ code: 'sync.push' })
    expect(check.runs).toBe(3)
    expect(calls.filter((call) => call === `push origin ${MAIN}`)).toHaveLength(3)
  })

  it('goes through once a repeated push lands', async () => {
    const { git } = fakeGit([rejected, rejected, {}])
    const check = passing()

    expect(await syncMain(git, '/home/john/repo', ['origin'], MAIN, check)).toBeNull()
    expect(check.runs).toBe(3)
  })
})
