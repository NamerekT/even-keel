import { join } from 'node:path'
import type { FinishOutcome, Git, TaskPlace } from './types.js'
import { dropBranch, finishWorktree, hasBranch, must, taskPlace, worktreesAt } from './worktree.js'

export interface SlotUse {
  idle: boolean
  busy: string[]
}

export interface SlotPool {
  count: number
  occupancy: (path: string) => SlotUse
  vacate: (path: string) => Promise<void>
}

export function slotPaths(repo: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => join(repo, '.claude', 'worktrees', index === 0 ? 'even-keel' : `even-keel-${index + 1}`))
}

export async function prepareSlot(git: Git, repo: string, task: string, options: Partial<SlotPool> = {}): Promise<TaskPlace> {
  const { count = 1, occupancy = () => ({ idle: false, busy: [] }), vacate = async () => {} } = options
  const place = taskPlace(repo, task)
  const paths = slotPaths(repo, count)
  const [own, ...slots] = await worktreesAt(git, repo, [place.path, ...paths])
  if (own !== undefined) return { path: place.path, branch: own.branch }
  const holding = slots.findIndex((slot) => isTaskBranch(slot?.branch ?? null, task))
  if (holding !== -1) return { path: paths[holding]!, branch: slots[holding]!.branch! }

  const free: { path: string; rank: number }[] = []
  const refusals: string[] = []
  for (const [index, slot] of slots.entries()) {
    const path = paths[index]!
    if (slot === undefined) {
      free.push({ path, rank: 2 })
      continue
    }
    const status = await must(git, path, ['status', '--porcelain'], 'read the status of')
    if (status.out !== '') {
      refusals.push(`the slot ${path} has uncommitted changes; commit or remove them:\n${status.out}`)
      continue
    }
    const use = occupancy(path)
    if (use.busy.length > 0) {
      refusals.push(`the slot ${path} is in use by ${use.busy.join(', ')} mid-turn; let it finish or stop it`)
      continue
    }
    free.push({ path, rank: use.idle ? 3 : slot.branch === null ? 0 : 1 })
  }
  const chosen = free.sort((a, b) => a.rank - b.rank)[0]
  if (chosen === undefined) throw new Error(`git: no slot is free, ${task} was not started; free one, then resume:\n${refusals.join('\n')}`)

  if (chosen.rank === 2) await must(git, repo, ['worktree', 'add', '--detach', chosen.path, 'main'], 'add the slot to')
  else await vacate(chosen.path)
  await must(git, chosen.path, ['clean', '-fd'], 'clean')
  const args = (await hasBranch(git, repo, place.branch)) ? ['switch', place.branch] : ['switch', '-c', place.branch, 'main']
  await must(git, chosen.path, args, `switch to ${place.branch} in`)
  return { path: chosen.path, branch: place.branch }
}

export async function finishSlot(git: Git, repo: string, task: string, count = 1): Promise<FinishOutcome> {
  const place = taskPlace(repo, task)
  const paths = slotPaths(repo, count)
  const [own, ...slots] = await worktreesAt(git, repo, [place.path, ...paths])
  if (own !== undefined) return finishWorktree(git, repo, task)

  const holding = slots.findIndex((slot) => isTaskBranch(slot?.branch ?? null, task))
  if (holding === -1) return dropBranch(git, repo, task, (await hasBranch(git, repo, place.branch)) ? place.branch : null, [])
  const path = paths[holding]!
  const branch = slots[holding]!.branch!
  const kept = await leaveBranch(git, path)
  if (kept === null) return dropBranch(git, repo, task, branch, [])
  return dropBranch(git, repo, task, null, [`${task}: the slot ${path} was kept on ${branch}: ${kept}`])
}

async function leaveBranch(git: Git, path: string): Promise<string | null> {
  const status = await git(path, ['status', '--porcelain'])
  if (status.code !== 0) return status.out
  if (status.out.trim() !== '') return `it has uncommitted changes:\n${status.out.trim()}`
  const switched = await git(path, ['switch', '--detach', 'main'])
  return switched.code === 0 ? null : switched.out
}

function isTaskBranch(branch: string | null, task: string): branch is string {
  return branch !== null && branch.startsWith(`${task.toLowerCase()}/`)
}
