import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { branchMerged } from './merged.js'
import { runGit } from './run.js'

let repo: string

const git = async (...args: string[]) => {
  const result = await runGit(repo, args)
  if (result.code !== 0) throw new Error(`git ${args.join(' ')}: ${result.out}`)
  return result.out
}

const commit = async (name: string) => {
  writeFileSync(join(repo, name), name)
  await git('add', name)
  await git('commit', '-q', '-m', name)
}

// Each test starts from a copy of one repository with a first commit: git is slow to start on Windows under a full run.
let base: string

beforeAll(async () => {
  base = repo = mkdtempSync(join(tmpdir(), 'even-keel-merged-'))
  await git('init', '-q', '--template=', '-b', 'main')
  await git('config', 'user.email', 'john.doe@example.com')
  await git('config', 'user.name', 'John Doe')
  await git('config', 'core.hooksPath', join(repo, 'no-hooks'))
  await commit('base')
})

afterAll(() => {
  rmSync(base, { recursive: true, force: true })
})

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'even-keel-merged-'))
  cpSync(base, repo, { recursive: true })
})

afterEach(() => {
  rmSync(repo, { recursive: true, force: true })
})

describe('branchMerged', { timeout: 30_000 }, () => {
  it('says no while the task has no branch', async () => {
    expect(await branchMerged(runGit, repo, 'ABC-7')).toBe(false)
  })

  it('says no for a fresh branch, even once main moves past it', async () => {
    await git('branch', 'abc-7/task', 'main')
    expect(await branchMerged(runGit, repo, 'ABC-7')).toBe(false)
    await commit('other')
    expect(await branchMerged(runGit, repo, 'ABC-7')).toBe(false)
  })

  it('says no for a branch that only caught up with main, with no commits of its own', async () => {
    await git('branch', 'abc-7/task', 'main')
    await commit('other')
    await git('switch', '-q', 'abc-7/task')
    await git('merge', '-q', '--ff-only', 'main')
    await git('switch', '-q', 'main')
    expect(await branchMerged(runGit, repo, 'ABC-7')).toBe(false)
  })

  it('says no for a branch reset to main after commits main never took', async () => {
    await git('switch', '-q', '-c', 'abc-7/task')
    await commit('work')
    await git('reset', '-q', '--hard', 'main')
    await git('switch', '-q', 'main')
    await commit('other')
    await git('branch', '-f', 'abc-7/task', 'main')
    expect(await branchMerged(runGit, repo, 'ABC-7')).toBe(false)
  })

  it('says yes for a branch merged after it caught up with main', async () => {
    await git('branch', 'abc-7/task', 'main')
    await commit('other')
    await git('switch', '-q', 'abc-7/task')
    await git('merge', '-q', '--ff-only', 'main')
    await commit('work')
    await git('switch', '-q', 'main')
    await git('merge', '-q', '--no-edit', 'abc-7/task')
    expect(await branchMerged(runGit, repo, 'ABC-7')).toBe(true)
  })

  it('says no while the branch has commits main does not', async () => {
    await git('switch', '-q', '-c', 'abc-7/task')
    await commit('work')
    await git('switch', '-q', 'main')
    expect(await branchMerged(runGit, repo, 'ABC-7')).toBe(false)
  })

  it('says yes once the branch is merged, by a merge commit or a fast-forward', async () => {
    await git('switch', '-q', '-c', 'abc-7/task')
    await commit('work')
    await git('switch', '-q', 'main')
    await git('merge', '-q', '--no-edit', 'abc-7/task')
    expect(await branchMerged(runGit, repo, 'ABC-7')).toBe(true)

    await git('switch', '-q', '-c', 'abc-8/by-hand')
    await commit('more')
    await git('switch', '-q', 'main')
    await commit('meanwhile')
    await git('merge', '-q', '--no-edit', 'abc-8/by-hand')
    expect(await branchMerged(runGit, repo, 'ABC-8')).toBe(true)
  })

  it('looks for the branch in the project’s main branch when it is not main', async () => {
    await git('branch', '-m', 'main', 'master')
    await git('switch', '-q', '-c', 'abc-7/task')
    await commit('work')
    await git('switch', '-q', 'master')
    expect(await branchMerged(runGit, repo, 'ABC-7', 'master')).toBe(false)
    await git('merge', '-q', '--no-edit', 'abc-7/task')
    expect(await branchMerged(runGit, repo, 'ABC-7', 'master')).toBe(true)
  })

  it('looks only at the branches of that task', async () => {
    await git('switch', '-q', '-c', 'abc-70/task')
    await commit('work')
    await git('switch', '-q', 'main')
    await git('merge', '-q', '--no-edit', 'abc-70/task')
    expect(await branchMerged(runGit, repo, 'ABC-7')).toBe(false)
  })
})
