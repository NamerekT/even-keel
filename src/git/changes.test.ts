import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { changesOf } from './changes.js'
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

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), 'even-keel-changes-'))
  await git('init', '-q', '--template=', '-b', 'main')
  await git('config', 'user.email', 'john.doe@example.com')
  await git('config', 'user.name', 'John Doe')
  await git('config', 'core.hooksPath', join(repo, 'no-hooks'))
  writeFileSync(join(repo, '.gitignore'), '.temp/\n')
  await git('add', '.gitignore')
  await git('commit', '-q', '-m', 'base')
  await git('switch', '-q', '-c', 'abc-1/task')
})

afterEach(() => {
  rmSync(repo, { recursive: true, force: true })
})

describe('changesOf', { timeout: 30_000 }, () => {
  it('finds nothing on a branch that is main, and none in ignored files', async () => {
    mkdirSync(join(repo, '.temp'))
    writeFileSync(join(repo, '.temp', 'note.md'), 'scratch')
    expect(await changesOf(runGit, repo, 'main')).toEqual({ ahead: 0, files: 0 })
  })

  it('finds nothing on a branch main has moved past', async () => {
    await git('switch', '-q', 'main')
    await commit('later')
    await git('switch', '-q', 'abc-1/task')
    expect(await changesOf(runGit, repo, 'main')).toEqual({ ahead: 0, files: 0 })
  })

  it('counts the commits of the branch beyond main', async () => {
    await commit('one')
    await commit('two')
    expect(await changesOf(runGit, repo, 'main')).toEqual({ ahead: 2, files: 0 })
  })

  it('counts the changed and the new files as work left out of a commit', async () => {
    writeFileSync(join(repo, 'new.txt'), 'new')
    mkdirSync(join(repo, 'src'))
    writeFileSync(join(repo, 'src', 'a.ts'), 'a')
    writeFileSync(join(repo, 'src', 'b.ts'), 'b')
    expect(await changesOf(runGit, repo, 'main')).toEqual({ ahead: 0, files: 3 })
    rmSync(join(repo, 'new.txt'))
    rmSync(join(repo, 'src'), { recursive: true })
    writeFileSync(join(repo, '.gitignore'), 'changed\n')
    await git('add', '.gitignore')
    expect(await changesOf(runGit, repo, 'main')).toEqual({ ahead: 0, files: 1 })
  })

  it('fails when git cannot count, as without the main branch', async () => {
    await expect(changesOf(runGit, repo, 'trunk')).rejects.toMatchObject({ notice: { code: 'git.failed', params: { step: 'countCommits' } } })
  })
})
