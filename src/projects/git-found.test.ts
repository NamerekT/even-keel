import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runGit } from '../git/run.js'
import type { Git } from '../git/types.js'
import { foundRepository, GitFound } from './git-found.js'

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

function folder(): string {
  const made = mkdtempSync(join(tmpdir(), 'ek-git-found-'))
  folders.push(made)
  return made
}

/** Real git that records each call. */
function counted(): { git: Git; calls: string[][] } {
  const calls: string[][] = []
  return { calls, git: (cwd, args) => (calls.push(args), runGit(cwd, args)) }
}

describe('foundRepository', { timeout: 30_000 }, () => {
  it('finds a repository at the top of the folder with the branch its HEAD points at', async () => {
    const path = folder()
    await runGit(path, ['init', '-q', '-b', 'master'])
    const { git, calls } = counted()
    const found = await foundRepository(git, path, true)
    expect(found).toEqual({ branch: 'master', since: expect.any(Number) })
    expect(found!.since).toBeGreaterThan(0)
    expect(calls).toEqual([['rev-parse', '--show-toplevel']])
  })

  it('never calls git when git does not start on the machine', async () => {
    const path = folder()
    await runGit(path, ['init', '-q'])
    const { git, calls } = counted()
    expect(await foundRepository(git, path, false)).toBeNull()
    expect(calls).toEqual([])
  })

  it('never calls git in a folder without its own .git, even one inside another repository', async () => {
    const outer = folder()
    await runGit(outer, ['init', '-q'])
    const inner = join(outer, 'notes')
    mkdirSync(inner)
    const { git, calls } = counted()
    expect(await foundRepository(git, inner, true)).toBeNull()
    expect(calls).toEqual([])
  })

  it('takes an empty .git for no repository', async () => {
    const outer = folder()
    await runGit(outer, ['init', '-q'])
    const inner = join(outer, 'notes')
    mkdirSync(join(inner, '.git'), { recursive: true })
    expect(await foundRepository(runGit, inner, true)).toBeNull()
  })

  it('takes a missing folder for no repository', async () => {
    expect(await foundRepository(runGit, join(folder(), 'gone'), true)).toBeNull()
  })
})

describe('GitFound', { timeout: 30_000 }, () => {
  it('keeps what the last check of each project without git found, and tells when it changes', async () => {
    const path = folder()
    let starts = true
    let changes = 0
    const projects: Record<string, string> = { a: path }
    const found = new GitFound({ git: runGit, gitStarts: () => starts, folders: () => projects })
    found.changed = () => changes++
    await found.checkAll()
    expect(found.view()).toEqual({})
    expect(changes).toBe(0)

    await runGit(path, ['init', '-q', '-b', 'master'])
    await found.check('a')
    expect(found.view()).toEqual({ a: { branch: 'master', since: expect.any(Number) } })
    expect(changes).toBe(1)
    await found.check('a')
    expect(changes).toBe(1)

    starts = false
    await found.check('a')
    expect(found.view()).toEqual({})
    expect(changes).toBe(2)
  })

  it('shows no project that has git on now or is gone', async () => {
    const path = folder()
    await runGit(path, ['init', '-q'])
    const projects: Record<string, string> = { a: path }
    const found = new GitFound({ git: runGit, gitStarts: () => true, folders: () => projects })
    await found.checkAll()
    expect(Object.keys(found.view())).toEqual(['a'])
    delete projects.a
    expect(found.view()).toEqual({})
  })
})
