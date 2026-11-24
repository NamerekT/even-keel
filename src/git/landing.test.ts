import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { landTask } from './landing.js'
import { landedCommit, landedCommits } from './merged.js'
import { runGit } from './run.js'
import type { MergeCheck } from './sync.js'
import { copyRepository } from './template.fixture.js'
import type { Git } from './types.js'

// The main branch is not called `main`: the user's global `git sync` alias, written for main, would take the landing.
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

const write = async (repo: string, name: string, text: string) => {
  writeFileSync(join(repo, name), text)
  await git(repo, 'add', name)
  await git(repo, 'commit', '-q', '-m', `${name}: ${text}`)
}

const clone = async (root: string, name: string) => {
  const path = join(root, name)
  await git(root, 'clone', '-q', join(root, 'remote.git'), path)
  await git(path, 'config', 'user.email', 'john.doe@example.com')
  await git(path, 'config', 'user.name', 'John Doe')
  await git(path, 'config', 'core.hooksPath', join(root, 'no-hooks'))
  return path
}

async function remoteAndClones(root: string): Promise<void> {
  await git(root, 'init', '-q', '--bare', '-b', MAIN, join(root, 'remote.git'))
  const path = await clone(root, 'first')
  await git(path, 'checkout', '-q', '-b', MAIN)
  await write(path, 'shared.txt', 'base')
  await git(path, 'push', '-q', '-u', 'origin', MAIN)
  await clone(root, 'second')
}

/** The task's session on `first`: a commit on its branch, merged into main of the checkout with a merge commit. */
async function mergeTask(text = 'task', file = 'shared.txt'): Promise<string> {
  const before = await git(first, 'rev-parse', MAIN)
  await git(first, 'checkout', '-q', '-b', 'abc-1/task')
  await write(first, file, text)
  await git(first, 'checkout', '-q', MAIN)
  await git(first, 'merge', '-q', '--no-ff', '--no-edit', 'abc-1/task')
  return before
}

/** Another machine's work on the remote's main. */
async function pushElsewhere(file: string, text: string): Promise<void> {
  await git(second, 'pull', '-q', 'origin', MAIN)
  await write(second, file, text)
  await git(second, 'push', '-q', 'origin', MAIN)
}

const checking = (red: { command: string; code: number; output: string } | null = null): MergeCheck & { runs: number } => {
  const check = { runs: 0, run: async () => (check.runs++, red) }
  return check
}

const land = (options: { check?: MergeCheck; commit?: string; git?: Git } = {}) =>
  landTask(options.git ?? runGit, first, { task: 'ABC-1', main: MAIN, ...(options.check && { check: options.check }), ...(options.commit && { commit: options.commit }) })

describe('landTask (BTN-1581)', { timeout: 60_000 }, () => {
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'even-keel-landing-'))
    await copyRepository('landing', root, remoteAndClones)
    remote = join(root, 'remote.git')
    first = join(root, 'first')
    second = join(root, 'second')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('has nothing to land before the merge, and after the push', async () => {
    expect(await land()).toEqual({ state: 'none' })
    await mergeTask()
    await git(first, 'push', '-q', 'origin', MAIN)
    expect(await land()).toEqual({ state: 'none' })
  })

  it('pushes main by fast-forward when the remote has nothing new, with no check', async () => {
    await mergeTask()
    expect(await landedCommits(runGit, first, 'ABC-1', MAIN)).toEqual([])
    const check = checking()

    expect(await land({ check })).toEqual({ state: 'landed' })

    expect(check.runs).toBe(0)
    expect(await git(remote, 'rev-parse', MAIN)).toBe(await git(first, 'rev-parse', MAIN))
    expect(await landedCommits(runGit, first, 'ABC-1', MAIN)).toHaveLength(1)
  })

  it('merges the remote that went ahead cleanly, runs the check and pushes', async () => {
    await mergeTask('task', 'own.txt')
    await pushElsewhere('other.txt', 'theirs')
    const check = checking()

    expect(await land({ check })).toEqual({ state: 'landed' })

    expect(check.runs).toBe(1)
    const log = await git(remote, 'log', '--format=%s', MAIN)
    expect(log).toContain('own.txt: task')
    expect(log).toContain('other.txt: theirs')
  })

  it('returns a conflict with its files and rolls main back to before the merge of the session', async () => {
    const before = await mergeTask('ours')
    await pushElsewhere('shared.txt', 'theirs')
    const remoteHead = await git(remote, 'rev-parse', MAIN)

    expect(await land({ check: checking() })).toEqual({ state: 'returned', remote: 'origin', files: ['shared.txt'] })

    expect(await git(first, 'rev-parse', MAIN)).toBe(before)
    expect(await git(first, 'status', '--porcelain')).toBe('')
    expect(await git(remote, 'rev-parse', MAIN)).toBe(remoteHead)
    expect(await git(first, 'rev-parse', '--verify', 'abc-1/task')).not.toBe('')
    expect(await land()).toEqual({ state: 'none' })
  })

  it('returns a red check of the clean merge and rolls main back', async () => {
    const before = await mergeTask('task', 'own.txt')
    await pushElsewhere('other.txt', 'theirs')
    const red = { command: 'npm test', code: 1, output: 'FAIL one.test.ts' }

    expect(await land({ check: checking(red) })).toEqual({ state: 'returned', remote: 'origin', red })

    expect(await git(first, 'rev-parse', MAIN)).toBe(before)
  })

  it('rolls back past a merge the session made by fast-forward', async () => {
    const before = await git(first, 'rev-parse', MAIN)
    await git(first, 'checkout', '-q', '-b', 'abc-1/task')
    await write(first, 'shared.txt', 'ours')
    await git(first, 'checkout', '-q', MAIN)
    await git(first, 'merge', '-q', '--ff-only', 'abc-1/task')
    await pushElsewhere('shared.txt', 'theirs')

    expect(await land()).toMatchObject({ state: 'returned', files: ['shared.txt'] })

    expect(await git(first, 'rev-parse', MAIN)).toBe(before)
  })

  it('rolls back past every commit of the branch when a later round fast-forwards main over them all', async () => {
    const before = await git(first, 'rev-parse', MAIN)
    await git(first, 'checkout', '-q', '-b', 'abc-1/task')
    await write(first, 'shared.txt', 'ours')
    await git(first, 'checkout', '-q', MAIN)
    await git(first, 'merge', '-q', '--ff-only', 'abc-1/task')
    await pushElsewhere('shared.txt', 'theirs')
    expect(await land()).toMatchObject({ state: 'returned' })
    // The session's next round adds a commit and merges again without the remote's work.
    await git(first, 'checkout', '-q', 'abc-1/task')
    await write(first, 'shared.txt', 'ours again')
    await git(first, 'checkout', '-q', MAIN)
    await git(first, 'merge', '-q', '--ff-only', 'abc-1/task')

    expect(await land()).toMatchObject({ state: 'returned', files: ['shared.txt'] })

    expect(await git(first, 'rev-parse', MAIN)).toBe(before)
  })

  it('fails as a network failure when the remote is out of reach, main as it was', async () => {
    const before = await mergeTask()
    const head = await git(first, 'rev-parse', MAIN)
    const offline: Git = (cwd, args, env) =>
      args[0] === 'fetch' ? Promise.resolve({ code: 128, out: "fatal: unable to access 'https://example.com/x.git/': Could not resolve host: example.com" }) : runGit(cwd, args, env)

    expect(await land({ git: offline })).toMatchObject({ state: 'failed', network: true, failure: { code: 'sync.fetch' } })

    expect(await git(first, 'rev-parse', MAIN)).toBe(head)
    expect(head).not.toBe(before)
  })

  it('fails as a refusal, not a network failure, when the remote declines the push', async () => {
    const hooks = join(root, 'remote-hooks')
    mkdirSync(hooks, { recursive: true })
    writeFileSync(join(hooks, 'pre-receive'), '#!/bin/sh\necho "pushes are closed" >&2\nexit 1\n')
    chmodSync(join(hooks, 'pre-receive'), 0o755)
    await git(remote, 'config', 'core.hooksPath', hooks)
    await mergeTask()

    const landed = await land()

    expect(landed).toMatchObject({ state: 'failed', network: false, failure: { code: 'sync.push' } })
    expect(landed.state === 'failed' && landed.failure.detail).toContain('pushes are closed')
  })

  it('lands through the repository own git sync alias and returns its conflict', async () => {
    await git(first, 'config', '--local', 'alias.sync', `!git fetch origin && git merge --no-edit origin/${MAIN} && git push origin ${MAIN}`)
    const before = await mergeTask('ours')
    await pushElsewhere('shared.txt', 'theirs')

    expect(await land()).toEqual({ state: 'returned', remote: 'origin', files: ['shared.txt'] })
    expect(await git(first, 'rev-parse', MAIN)).toBe(before)
    expect(await git(first, 'status', '--porcelain')).toBe('')

    await git(first, 'checkout', '-q', 'abc-1/task')
    await git(first, 'merge', '-q', '--no-edit', '-X', 'ours', `origin/${MAIN}`)
    await git(first, 'checkout', '-q', MAIN)
    await git(first, 'merge', '-q', '--no-edit', 'abc-1/task')
    expect(await land()).toEqual({ state: 'landed' })
  })

  it('lands the release commit of a carry, named by the caller', async () => {
    await git(first, 'checkout', '-q', '-b', 'release')
    await write(first, 'release.txt', 'fix')
    const commit = await git(first, 'rev-parse', 'HEAD')
    await git(first, 'checkout', '-q', MAIN)
    await git(first, 'merge', '-q', '--no-ff', '--no-edit', 'release')
    expect(await landedCommit(runGit, first, commit, MAIN)).toBe(false)

    expect(await land({ commit })).toEqual({ state: 'landed' })

    expect(await landedCommit(runGit, first, commit, MAIN)).toBe(true)
  })
})
