import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { finishSlot, prepareSlot, slotPath } from './slot.js'
import type { GitResult } from './types.js'

const repo = join(tmpdir(), 'abc')
const slot = join(repo, '.claude', 'worktrees', 'baton')
const own = join(repo, '.claude', 'worktrees', 'abc-7')
const porcelain = (path: string) => path.replaceAll('\\', '/')

function fakeGit(answers: Record<string, Partial<GitResult> | Partial<GitResult>[]> = {}) {
  const calls: string[] = []
  const git = async (cwd: string, args: string[]): Promise<GitResult> => {
    expect([repo, slot]).toContain(cwd)
    const command = `${cwd === slot ? '@slot ' : ''}${args.join(' ')}`
    calls.push(command)
    const answer = answers[command]
    const next = Array.isArray(answer) ? (answer.length > 1 ? answer.shift() : answer[0]) : answer
    return { code: 0, out: '', ...next }
  }
  return { git, calls }
}

const listing = (...trees: [string, string | null][]) => ({
  out: [[porcelain(repo), 'main'] as [string, string | null], ...trees]
    .map(([path, branch]) => [`worktree ${path}`, 'HEAD 25064bcf', branch === null ? 'detached' : `branch refs/heads/${branch}`].join('\n'))
    .join('\n\n'),
})

const LIST = 'worktree list --porcelain'
const HAS_BRANCH = 'rev-parse --verify --quiet refs/heads/abc-7/task'
const changing = (calls: string[]) =>
  calls.filter((call) => /^(@slot )?(worktree (add|remove)|switch|clean|reset|stash|checkout|branch -d)/.test(call))

describe('slotPath', () => {
  it('is one standing worktree per repository', () => {
    expect(slotPath(repo)).toBe(slot)
  })
})

describe('prepareSlot', () => {
  it('adds the slot on a detached main once, then puts a new task branch off main in it', async () => {
    const { git, calls } = fakeGit({ [LIST]: listing(), [HAS_BRANCH]: { code: 1 } })
    expect(await prepareSlot(git, repo, 'ABC-7')).toEqual({ path: slot, branch: 'abc-7/task' })
    expect(changing(calls)).toEqual([`worktree add --detach ${slot} main`, '@slot clean -fd', '@slot switch -c abc-7/task main'])
  })

  it('cleans a clean slot and makes a new branch off main when the task has none', async () => {
    const { git, calls } = fakeGit({ [LIST]: listing([porcelain(slot), 'abc-6/task']), [HAS_BRANCH]: { code: 1 } })
    expect(await prepareSlot(git, repo, 'ABC-7')).toEqual({ path: slot, branch: 'abc-7/task' })
    expect(calls.indexOf('@slot status --porcelain')).toBeLessThan(calls.indexOf('@slot clean -fd'))
    expect(changing(calls)).toEqual(['@slot clean -fd', '@slot switch -c abc-7/task main'])
  })

  it('switches to the branch the task already has', async () => {
    const { git, calls } = fakeGit({ [LIST]: listing([porcelain(slot), null]) })
    expect(await prepareSlot(git, repo, 'ABC-7')).toEqual({ path: slot, branch: 'abc-7/task' })
    expect(changing(calls)).toEqual(['@slot clean -fd', '@slot switch abc-7/task'])
  })

  it('leaves the slot alone when it is already on the task’s branch, dirty or not', async () => {
    const { git, calls } = fakeGit({
      [LIST]: listing([porcelain(slot), 'abc-7/by-hand']),
      '@slot status --porcelain': { out: ' M src/app.ts' },
    })
    expect(await prepareSlot(git, repo, 'ABC-7')).toEqual({ path: slot, branch: 'abc-7/by-hand' })
    expect(changing(calls)).toEqual([])
  })

  it('refuses a dirty slot without touching it, naming the path and the changes', async () => {
    const { git, calls } = fakeGit({
      [LIST]: listing([porcelain(slot), 'abc-6/task']),
      '@slot status --porcelain': { out: ' M src/app.ts\n?? notes.md' },
    })
    await expect(prepareSlot(git, repo, 'ABC-7')).rejects.toThrow(new RegExp(`${slot.replaceAll('\\', '\\\\')}[\\s\\S]*notes\\.md`))
    expect(changing(calls)).toEqual([])
  })

  it('takes the task’s own worktree as it is, left from before the slot', async () => {
    const { git, calls } = fakeGit({ [LIST]: listing([porcelain(own), 'abc-7/task']) })
    expect(await prepareSlot(git, repo, 'ABC-7')).toEqual({ path: own, branch: 'abc-7/task' })
    expect(changing(calls)).toEqual([])
  })

  it('fails with the output of git when the branch cannot be switched to', async () => {
    const { git } = fakeGit({
      [LIST]: listing([porcelain(slot), null]),
      '@slot switch abc-7/task': { code: 128, out: "fatal: 'abc-7/task' is already used by worktree" },
    })
    await expect(prepareSlot(git, repo, 'ABC-7')).rejects.toThrow(/already used by worktree/)
  })
})

describe('finishSlot', () => {
  const done = { [LIST]: listing([porcelain(slot), 'abc-7/task']), remote: { out: 'origin\n' } }

  it('detaches the slot on main, keeps the folder, deletes the branch here and on origin, then syncs', async () => {
    const { git, calls } = fakeGit(done)
    expect(await finishSlot(git, repo, 'ABC-7')).toEqual({ warnings: [], syncError: null })
    expect(calls.filter((call) => !/^(@slot status|worktree (list|prune))/.test(call))).toEqual([
      '@slot switch --detach main',
      'branch -d abc-7/task',
      'remote',
      'ls-remote --exit-code --heads origin refs/heads/abc-7/task',
      'push origin --delete abc-7/task',
      'sync',
    ])
  })

  it('keeps a dirty slot on the task’s branch, keeps the branch, warns and still syncs', async () => {
    const { git, calls } = fakeGit({ ...done, '@slot status --porcelain': { out: '?? notes.md' } })
    const outcome = await finishSlot(git, repo, 'ABC-7')
    expect(outcome.warnings).toEqual([expect.stringMatching(/ABC-7.*abc-7\/task[\s\S]*notes\.md/)])
    expect(changing(calls)).toEqual([])
    expect(calls).toContain('sync')
  })

  it('warns when the slot cannot leave the branch and keeps the branch', async () => {
    const { git, calls } = fakeGit({ ...done, '@slot switch --detach main': { code: 1, out: 'error: cannot switch' } })
    const outcome = await finishSlot(git, repo, 'ABC-7')
    expect(outcome.warnings).toEqual([expect.stringMatching(/cannot switch/)])
    expect(calls.some((call) => call.startsWith('branch -d'))).toBe(false)
  })

  it('does not move a slot that already holds another task, only deletes this task’s branch', async () => {
    const { git, calls } = fakeGit({ ...done, [LIST]: listing([porcelain(slot), 'abc-8/task']) })
    expect(await finishSlot(git, repo, 'ABC-7')).toEqual({ warnings: [], syncError: null })
    expect(changing(calls)).toEqual(['branch -d abc-7/task'])
  })

  it('removes the task’s own worktree left from before the slot', async () => {
    const { git, calls } = fakeGit({ ...done, [LIST]: listing([porcelain(slot), null], [porcelain(own), 'abc-7/task']) })
    expect(await finishSlot(git, repo, 'ABC-7')).toEqual({ warnings: [], syncError: null })
    expect(changing(calls)).toEqual([`worktree remove ${own}`, 'branch -d abc-7/task'])
  })

  it('has nothing to delete when the task has no branch', async () => {
    const { git, calls } = fakeGit({ ...done, [LIST]: listing([porcelain(slot), null]), [HAS_BRANCH]: { code: 1 } })
    expect(await finishSlot(git, repo, 'ABC-7')).toEqual({ warnings: [], syncError: null })
    expect(changing(calls)).toEqual([])
  })
})
