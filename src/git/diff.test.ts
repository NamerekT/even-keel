import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { branchDiffOf } from './diff.js'
import { runGit } from './run.js'
import { copyRepository } from './template.fixture.js'

let repo: string

const git = async (cwd: string, ...args: string[]) => {
  const result = await runGit(cwd, args)
  if (result.code !== 0) throw new Error(`git ${args.join(' ')}: ${result.out}`)
  return result.out
}

const commit = async (name: string, text: string) => {
  writeFileSync(join(repo, name), text)
  await git(repo, 'add', name)
  await git(repo, 'commit', '-q', '-m', name)
}

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), 'even-keel-diff-'))
  await copyRepository('diff', repo, async (path) => {
    await git(path, 'init', '-q', '--template=', '-b', 'trunk')
    await git(path, 'config', 'user.email', 'john.doe@example.com')
    await git(path, 'config', 'user.name', 'John Doe')
    await git(path, 'config', 'core.autocrlf', 'false')
    await git(path, 'config', 'core.hooksPath', join(path, 'no-hooks'))
    for (const [name, text] of [['.gitignore', '.temp/\n'], ['base.ts', 'one\ntwo\nthree\n']] as const) {
      writeFileSync(join(path, name), text)
      await git(path, 'add', name)
      await git(path, 'commit', '-q', '-m', name)
    }
  })
})

afterEach(() => {
  rmSync(repo, { recursive: true, force: true })
})

describe('branchDiffOf', { timeout: 30_000 }, () => {
  it('counts the branch’s commits, the uncommitted edits and the new files, against where it left main', async () => {
    await git(repo, 'switch', '-q', '-c', 'abc-1/task')
    await commit('base.ts', 'one\n2\nthree\nfour\n')
    writeFileSync(join(repo, 'base.ts'), 'one\n2\nthree\nfour\nfive\n')
    writeFileSync(join(repo, 'new.ts'), 'a\nb')
    mkdirSync(join(repo, '.temp'))
    writeFileSync(join(repo, '.temp', 'note.md'), 'not\nwork\n')
    writeFileSync(join(repo, 'shot.png'), Buffer.from([0x89, 0x50, 0x00, 0x0a]))
    expect(await branchDiffOf(runGit, repo, 'trunk')).toEqual({ added: 5, removed: 1 })
  })

  it('leaves out what main got after the branch left it', async () => {
    await git(repo, 'switch', '-q', '-c', 'abc-1/task')
    await commit('task.ts', 'x\n')
    await git(repo, 'switch', '-q', 'trunk')
    await commit('main.ts', 'm\nn\n')
    await git(repo, 'switch', '-q', 'abc-1/task')
    expect(await branchDiffOf(runGit, repo, 'trunk')).toEqual({ added: 1, removed: 0 })
  })

  it('is zero for a branch merged into main', async () => {
    await git(repo, 'switch', '-q', '-c', 'abc-1/task')
    await commit('task.ts', 'x\n')
    await git(repo, 'switch', '-q', 'trunk')
    await git(repo, 'merge', '-q', '--no-edit', 'abc-1/task')
    await git(repo, 'switch', '-q', 'abc-1/task')
    expect(await branchDiffOf(runGit, repo, 'trunk')).toEqual({ added: 0, removed: 0 })
  })
})
