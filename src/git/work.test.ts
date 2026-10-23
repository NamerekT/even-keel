import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TaskWork } from '../state.js'
import { runGit } from './run.js'
import { slotPaths } from './slot.js'
import { taskPlace } from './worktree.js'
import { TaskWorks, worksOf } from './work.js'

let repo: string

const git = async (cwd: string, ...args: string[]) => {
  const result = await runGit(cwd, args)
  if (result.code !== 0) throw new Error(`git ${args.join(' ')}: ${result.out}`)
  return result.out
}

const commit = async (cwd: string, name: string) => {
  writeFileSync(join(cwd, name), name)
  await git(cwd, 'add', name)
  await git(cwd, 'commit', '-q', '-m', name)
}

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), 'even-keel-work-'))
  await git(repo, 'init', '-q', '--template=', '-b', 'trunk')
  await git(repo, 'config', 'user.email', 'john.doe@example.com')
  await git(repo, 'config', 'user.name', 'John Doe')
  await git(repo, 'config', 'core.hooksPath', join(repo, 'no-hooks'))
  writeFileSync(join(repo, '.gitignore'), '.claude/worktrees/\n.temp/\n')
  await git(repo, 'add', '.gitignore')
  await git(repo, 'commit', '-q', '-m', 'base')
})

afterEach(() => {
  rmSync(repo, { recursive: true, force: true })
})

describe('worksOf', { timeout: 30_000 }, () => {
  it('finds the work of each task in its worktree or slot, against the main branch, and leaves the clean ones out', async () => {
    const own = taskPlace(repo, 'ABC-1')
    await git(repo, 'worktree', 'add', '-q', '-b', own.branch, own.path, 'trunk')
    writeFileSync(join(own.path, 'a.ts'), 'a')
    writeFileSync(join(own.path, 'b.ts'), 'b')
    mkdirSync(join(own.path, '.temp'))
    writeFileSync(join(own.path, '.temp', 'note.md'), 'scratch')

    const [slot] = slotPaths(repo, 1)
    await git(repo, 'worktree', 'add', '-q', '-b', 'abc-2/by-hand', slot!, 'trunk')
    await commit(slot!, 'one')
    await commit(slot!, 'two')

    const clean = taskPlace(repo, 'ABC-3')
    await git(repo, 'worktree', 'add', '-q', '-b', clean.branch, clean.path, 'trunk')
    const stranger = taskPlace(repo, 'ABC-9')
    await git(repo, 'worktree', 'add', '-q', '-b', stranger.branch, stranger.path, 'trunk')
    writeFileSync(join(stranger.path, 'c.ts'), 'c')

    const works = await worksOf(runGit, repo, 'trunk', ['ABC-1', 'ABC-2', 'ABC-3', 'ABC-4'])
    expect(works).toEqual({
      'ABC-1': { path: expect.stringMatching(/abc-1$/), branch: 'abc-1/task', files: 2, ahead: 0 },
      'ABC-2': { path: expect.stringMatching(/even-keel$/), branch: 'abc-2/by-hand', files: 0, ahead: 2 },
    })
  })

  it('takes nothing from the main checkout, even on a task branch', async () => {
    await git(repo, 'switch', '-q', '-c', 'abc-1/task')
    writeFileSync(join(repo, 'a.ts'), 'a')
    expect(await worksOf(runGit, repo, 'trunk', ['ABC-1'])).toEqual({})
  })

  it('does not take ABC-1 for ABC-12', async () => {
    const place = taskPlace(repo, 'ABC-12')
    await git(repo, 'worktree', 'add', '-q', '-b', place.branch, place.path, 'trunk')
    writeFileSync(join(place.path, 'a.ts'), 'a')
    expect(Object.keys(await worksOf(runGit, repo, 'trunk', ['ABC-1', 'ABC-12']))).toEqual(['ABC-12'])
  })
})

describe('TaskWorks', () => {
  const work: TaskWork = { path: 'D:/work/abc/.claude/worktrees/abc-1', branch: 'abc-1/task', files: 3, ahead: 0 }

  function setup(answers: (Record<string, TaskWork> | Error)[]) {
    let now = 0
    let reads = 0
    const changes: number[] = []
    const logged: string[] = []
    const works = new TaskWorks({
      read: async () => {
        const answer = answers[Math.min(reads++, answers.length - 1)]!
        if (answer instanceof Error) throw answer
        return answer
      },
      ttlMs: 60_000,
      now: () => now,
      onChange: () => changes.push(now),
      log: (line) => logged.push(line),
    })
    return { works, changes, logged, reads: () => reads, at: (ms: number) => (now = ms) }
  }

  it('reads a project once a minute and tells only of a change', async () => {
    const context = setup([{ 'ABC-1': work }, { 'ABC-1': work }, {}])
    await context.works.poll('abc')
    expect(context.works.view()).toEqual({ abc: { 'ABC-1': work } })
    expect(context.changes).toEqual([0])

    context.at(30_000)
    await context.works.poll('abc')
    expect(context.reads()).toBe(1)

    context.at(60_000)
    await context.works.poll('abc')
    expect(context.reads()).toBe(2)
    expect(context.changes).toEqual([0])

    context.at(120_000)
    await context.works.poll('abc')
    expect(context.works.view()).toEqual({})
    expect(context.changes).toEqual([0, 120_000])
  })

  it('keeps what it saw when a read fails, and logs one failure once', async () => {
    const context = setup([{ 'ABC-1': work }, new Error('no repo'), new Error('no repo')])
    await context.works.poll('abc')
    context.at(60_000)
    await context.works.poll('abc')
    context.at(120_000)
    await context.works.poll('abc')
    expect(context.works.view()).toEqual({ abc: { 'ABC-1': work } })
    expect(context.logged).toEqual(['work: abc: the task worktrees were not read: no repo'])
  })

  it('reads again at once after a cleanup, past the minute and after a read already under way', async () => {
    let release = () => {}
    const answers = [{ 'ABC-1': work }, {}]
    let reads = 0
    const works = new TaskWorks({
      read: async () => {
        const answer = answers[Math.min(reads++, answers.length - 1)]!
        if (reads === 1) await new Promise<void>((resolve) => (release = resolve))
        return answer
      },
      ttlMs: 60_000,
      now: () => 0,
      onChange: () => {},
      log: () => {},
    })
    const first = works.poll('abc')
    const fresh = works.refresh('abc')
    release()
    await Promise.all([first, fresh])
    expect(reads).toBe(2)
    expect(works.view()).toEqual({})
  })

  it('drops the projects no longer configured', async () => {
    const context = setup([{ 'ABC-1': work }])
    await context.works.poll('abc')
    context.works.keep(['other'])
    expect(context.works.view()).toEqual({})
    expect(context.changes).toHaveLength(2)
  })
})
