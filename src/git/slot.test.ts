import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { finishSlot, heldSlot, prepareSlot, slotPaths, type SlotUse } from './slot.js'
import type { GitResult } from './types.js'
import { englishOf } from '../notice/notice.js'

const repo = join(tmpdir(), 'abc')
const slot = join(repo, '.claude', 'worktrees', 'even-keel')
const slot2 = join(repo, '.claude', 'worktrees', 'even-keel-2')
const own = join(repo, '.claude', 'worktrees', 'abc-7')
const porcelain = (path: string) => path.replaceAll('\\', '/')
const PREFIX: Record<string, string> = { [slot]: '@slot ', [slot2]: '@slot2 ' }

function fakeGit(answers: Record<string, Partial<GitResult> | Partial<GitResult>[]> = {}) {
  const calls: string[] = []
  const git = async (cwd: string, args: string[]): Promise<GitResult> => {
    expect([repo, slot, slot2]).toContain(cwd)
    const command = `${PREFIX[cwd] ?? ''}${args.join(' ')}`
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
  calls.filter((call) => /^(@slot2? )?(worktree (add|remove)|switch|clean|reset|stash|checkout|branch -d)/.test(call))

describe('slotPaths', () => {
  it('keeps the first standing worktree where a single slot was and numbers the rest', () => {
    expect(slotPaths(repo, 1)).toEqual([slot])
    expect(slotPaths(repo, 2)).toEqual([slot, slot2])
  })
})

describe('prepareSlot', () => {
  it('adds the slot on a detached main once, then puts a new task branch off main in it', async () => {
    const { git, calls } = fakeGit({ [LIST]: listing(), [HAS_BRANCH]: { code: 1 } })
    expect(await prepareSlot(git, repo, 'ABC-7')).toEqual({ path: slot, branch: 'abc-7/task' })
    expect(changing(calls)).toEqual([`worktree add --detach ${slot} main`, '@slot clean -fd', '@slot switch -c abc-7/task main'])
  })

  it('adds the slot and the task branch off the project’s main branch when it is not main', async () => {
    const { git, calls } = fakeGit({ [LIST]: listing(), [HAS_BRANCH]: { code: 1 } })
    await prepareSlot(git, repo, 'ABC-7', { main: 'master' })
    expect(calls).toContain(`worktree add --detach ${slot} master`)
    expect(calls).toContain('@slot switch -c abc-7/task master')
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

  it('vacates the slot after the status check and before it is cleaned and switched', async () => {
    const { git, calls } = fakeGit({ [LIST]: listing([porcelain(slot), 'abc-6/task']) })
    await prepareSlot(git, repo, 'ABC-7', {
      vacate: async () => {
        calls.push('vacate')
      },
    })
    expect(calls.indexOf('@slot status --porcelain')).toBeLessThan(calls.indexOf('vacate'))
    expect(calls.indexOf('vacate')).toBeLessThan(calls.indexOf('@slot clean -fd'))
  })

  it('does not vacate a slot that stays as it is or is refused', async () => {
    const cases = [
      { [LIST]: listing([porcelain(slot), 'abc-7/task']) },
      { [LIST]: listing([porcelain(own), 'abc-7/task']) },
      { [LIST]: listing([porcelain(slot), 'abc-6/task']), '@slot status --porcelain': { out: '?? notes.md' } },
    ]
    for (const answers of cases) {
      let vacated = false
      await prepareSlot(fakeGit(answers).git, repo, 'ABC-7', {
        vacate: async () => {
          vacated = true
        },
      }).catch(() => undefined)
      expect(vacated).toBe(false)
    }
  })

  it('switches nothing when the slot cannot be vacated', async () => {
    const { git, calls } = fakeGit({ [LIST]: listing([porcelain(slot), 'abc-6/task']) })
    const vacate = async () => {
      throw new Error('ABC-6 is mid-turn in the slot')
    }
    await expect(prepareSlot(git, repo, 'ABC-7', { vacate })).rejects.toThrow(/ABC-6 is mid-turn/)
    expect(changing(calls)).toEqual([])
  })

  it('refuses a slot where another task is mid-turn without vacating it', async () => {
    const { git, calls } = fakeGit({ [LIST]: listing([porcelain(slot), 'abc-6/task']) })
    let vacated = false
    const pool = {
      occupancy: (): SlotUse => ({ idle: false, busy: ['ABC-6 (session s6)'] }),
      vacate: async () => {
        vacated = true
      },
    }
    await expect(prepareSlot(git, repo, 'ABC-7', pool)).rejects.toThrow(/ABC-6 \(session s6\) mid-turn/)
    expect(vacated).toBe(false)
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

describe('prepareSlot with a pool of two', () => {
  const free = (): SlotUse => ({ idle: false, busy: [] })
  const held =
    (uses: Record<string, SlotUse>) =>
    (path: string): SlotUse =>
      uses[path] ?? free()
  const idle: SlotUse = { idle: true, busy: [] }
  const busy: SlotUse = { idle: false, busy: ['ABC-6 (session s6)'] }

  function pooled(occupancy: (path: string) => SlotUse = free) {
    const vacated: string[] = []
    return {
      vacated,
      pool: {
        count: 2,
        occupancy,
        vacate: async (path: string) => {
          vacated.push(path)
        },
      },
    }
  }

  it('takes the first free slot and does not add the second', async () => {
    const { git, calls } = fakeGit({ [LIST]: listing([porcelain(slot), null]), [HAS_BRANCH]: { code: 1 } })
    expect(await prepareSlot(git, repo, 'ABC-7', pooled().pool)).toEqual({ path: slot, branch: 'abc-7/task' })
    expect(changing(calls)).toEqual(['@slot clean -fd', '@slot switch -c abc-7/task main'])
  })

  it('returns the slot that is already on the task’s branch, whichever it is', async () => {
    const { git, calls } = fakeGit({ [LIST]: listing([porcelain(slot), null], [porcelain(slot2), 'abc-7/task']) })
    expect(await prepareSlot(git, repo, 'ABC-7', pooled().pool)).toEqual({ path: slot2, branch: 'abc-7/task' })
    expect(changing(calls)).toEqual([])
  })

  it('finds the task in a slot past a shrunk pool, and never takes a free one there', async () => {
    const { git } = fakeGit({ [LIST]: listing([porcelain(slot), null], [porcelain(slot2), 'abc-7/task']) })
    expect(await prepareSlot(git, repo, 'ABC-7', { ...pooled().pool, count: 1, span: 2 })).toEqual({ path: slot2, branch: 'abc-7/task' })
    expect(await heldSlot(git, repo, 'ABC-7', 2)).toEqual({ path: slot2, branch: 'abc-7/task' })
    const other = fakeGit({ [LIST]: listing([porcelain(slot), 'abc-6/task'], [porcelain(slot2), null]), [HAS_BRANCH]: { code: 1 } })
    await expect(prepareSlot(other.git, repo, 'ABC-7', { ...pooled(held({ [slot]: busy })).pool, count: 1, span: 2 })).rejects.toThrow()
  })

  it('leaves a slot taken ahead of the launch detached at main, without the task branch', async () => {
    const { git, calls } = fakeGit({ [LIST]: listing([porcelain(slot), 'abc-6/task']), [HAS_BRANCH]: { code: 1 } })
    expect(await prepareSlot(git, repo, 'ABC-7', { ...pooled().pool, ahead: true })).toEqual({ path: slot, branch: null })
    expect(changing(calls)).toEqual(['@slot clean -fd', '@slot switch --detach main'])
  })

  it('does not move a detached slot taken ahead: the launch brings it up to main', async () => {
    const { git, calls } = fakeGit({ [LIST]: listing([porcelain(slot), null]), [HAS_BRANCH]: { code: 1 } })
    expect(await prepareSlot(git, repo, 'ABC-7', { ...pooled().pool, ahead: true })).toEqual({ path: slot, branch: null })
    expect(changing(calls)).toEqual(['@slot clean -fd'])
  })

  it('switches to the branch a task already has even ahead of the launch', async () => {
    const { git, calls } = fakeGit({ [LIST]: listing([porcelain(slot), null]) })
    expect(await prepareSlot(git, repo, 'ABC-7', { ...pooled().pool, ahead: true })).toEqual({ path: slot, branch: 'abc-7/task' })
    expect(changing(calls)).toEqual(['@slot clean -fd', '@slot switch abc-7/task'])
  })

  it('makes the task branch at the launch in the slot taken ahead, dirty or not, off its own commit', async () => {
    const { git, calls } = fakeGit({
      [LIST]: listing([porcelain(slot), null], [porcelain(slot2), null]),
      [HAS_BRANCH]: { code: 1 },
      '@slot2 status --porcelain': { out: ' M package-lock.json' },
    })
    const { pool, vacated } = pooled()
    expect(await prepareSlot(git, repo, 'ABC-7', { ...pool, at: slot2 })).toEqual({ path: slot2, branch: 'abc-7/task' })
    expect(changing(calls)).toEqual(['@slot2 switch -c abc-7/task'])
    expect(vacated).toEqual([])
  })

  it('keeps the slot taken ahead as it is when it is asked for ahead again', async () => {
    const { git, calls } = fakeGit({ [LIST]: listing([porcelain(slot), null], [porcelain(slot2), null]), [HAS_BRANCH]: { code: 1 } })
    expect(await prepareSlot(git, repo, 'ABC-7', { ...pooled().pool, ahead: true, at: slot2 })).toEqual({ path: slot2, branch: null })
    expect(changing(calls)).toEqual([])
  })

  it('picks a slot anew at the launch when the one taken ahead is on a branch by now', async () => {
    const { git, calls } = fakeGit({ [LIST]: listing([porcelain(slot), null], [porcelain(slot2), 'abc-9/task']), [HAS_BRANCH]: { code: 1 } })
    expect(await prepareSlot(git, repo, 'ABC-7', { ...pooled().pool, at: slot2 })).toEqual({ path: slot, branch: 'abc-7/task' })
    expect(changing(calls)).toEqual(['@slot clean -fd', '@slot switch -c abc-7/task main'])
  })

  it('adds the second slot rather than stop a session of another task in the first', async () => {
    const { git, calls } = fakeGit({ [LIST]: listing([porcelain(slot), 'abc-6/task']), [HAS_BRANCH]: { code: 1 } })
    const { pool, vacated } = pooled(held({ [slot]: idle }))
    expect(await prepareSlot(git, repo, 'ABC-7', pool)).toEqual({ path: slot2, branch: 'abc-7/task' })
    expect(changing(calls)).toEqual([`worktree add --detach ${slot2} main`, '@slot2 clean -fd', '@slot2 switch -c abc-7/task main'])
    expect(vacated).toEqual([])
  })

  it('reuses a slot left on another task’s branch with no sessions rather than add one', async () => {
    const { git, calls } = fakeGit({ [LIST]: listing([porcelain(slot), 'abc-6/task']), [HAS_BRANCH]: { code: 1 } })
    expect(await prepareSlot(git, repo, 'ABC-7', pooled().pool)).toEqual({ path: slot, branch: 'abc-7/task' })
    expect(changing(calls)).toEqual(['@slot clean -fd', '@slot switch -c abc-7/task main'])
  })

  it('prefers a detached slot to one left on another task’s branch', async () => {
    const { git } = fakeGit({ [LIST]: listing([porcelain(slot), 'abc-6/task'], [porcelain(slot2), null]), [HAS_BRANCH]: { code: 1 } })
    expect(await prepareSlot(git, repo, 'ABC-7', pooled().pool)).toEqual({ path: slot2, branch: 'abc-7/task' })
  })

  it('stops idle sessions only when every slot is taken, and only in the slot it takes', async () => {
    const { git, calls } = fakeGit({
      [LIST]: listing([porcelain(slot), 'abc-6/task'], [porcelain(slot2), 'abc-8/task']),
      [HAS_BRANCH]: { code: 1 },
    })
    const { pool, vacated } = pooled(held({ [slot]: busy, [slot2]: idle }))
    expect(await prepareSlot(git, repo, 'ABC-7', pool)).toEqual({ path: slot2, branch: 'abc-7/task' })
    expect(vacated).toEqual([slot2])
    expect(changing(calls)).toEqual(['@slot2 clean -fd', '@slot2 switch -c abc-7/task main'])
  })

  it('refuses when no slot is usable, naming each slot and why, and touches none', async () => {
    const { git, calls } = fakeGit({
      [LIST]: listing([porcelain(slot), 'abc-6/task'], [porcelain(slot2), 'abc-8/task']),
      '@slot2 status --porcelain': { out: '?? notes.md' },
    })
    const { pool, vacated } = pooled(held({ [slot]: busy }))
    const failure = prepareSlot(git, repo, 'ABC-7', pool)
    await expect(failure).rejects.toThrow(/ABC-6 \(session s6\) mid-turn/)
    await expect(failure).rejects.toThrow(new RegExp(`${slot2.replaceAll('\\', '\\\\')}[\\s\\S]*notes\\.md`))
    expect(vacated).toEqual([])
    expect(changing(calls)).toEqual([])
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
      'config --get alias.sync',
      'sync',
    ])
  })

  it('detaches the slot on the project’s main branch when it is not main', async () => {
    const { git, calls } = fakeGit({ ...done, 'config --local --get alias.sync': { code: 1 }, 'branch --show-current': { out: 'master' } })
    expect(await finishSlot(git, repo, 'ABC-7', 1, 'master')).toEqual({ warnings: [], syncError: null })
    expect(calls).toContain('@slot switch --detach master')
    expect(calls).toContain('push origin master')
  })

  it('keeps a dirty slot on the task’s branch, keeps the branch, warns and still syncs', async () => {
    const { git, calls } = fakeGit({ ...done, '@slot status --porcelain': { out: '?? notes.md' } })
    const outcome = await finishSlot(git, repo, 'ABC-7')
    expect(outcome.warnings.map(englishOf)).toEqual([expect.stringMatching(/abc-7\/task[\s\S]*notes\.md/)])
    expect(changing(calls)).toEqual([])
    expect(calls).toContain('sync')
  })

  it('warns when the slot cannot leave the branch and keeps the branch', async () => {
    const { git, calls } = fakeGit({ ...done, '@slot switch --detach main': { code: 1, out: 'error: cannot switch' } })
    const outcome = await finishSlot(git, repo, 'ABC-7')
    expect(outcome.warnings.map(englishOf)).toEqual([expect.stringMatching(/cannot switch/)])
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

  it('detaches whichever slot of the pool holds the task', async () => {
    const { git, calls } = fakeGit({ ...done, [LIST]: listing([porcelain(slot), 'abc-6/task'], [porcelain(slot2), 'abc-7/task']) })
    expect(await finishSlot(git, repo, 'ABC-7', 2)).toEqual({ warnings: [], syncError: null })
    expect(changing(calls)).toEqual(['@slot2 switch --detach main', 'branch -d abc-7/task'])
  })

  it('has nothing to delete when the task has no branch', async () => {
    const { git, calls } = fakeGit({ ...done, [LIST]: listing([porcelain(slot), null]), [HAS_BRANCH]: { code: 1 } })
    expect(await finishSlot(git, repo, 'ABC-7')).toEqual({ warnings: [], syncError: null })
    expect(changing(calls)).toEqual([])
  })
})
