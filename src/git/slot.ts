import { join } from 'node:path'
import type { FinishOutcome, Git, TaskPlace } from './types.js'
import { dropBranch, finishWorktree, hasBranch, must, taskPlace, worktreesAt } from './worktree.js'

export function slotPath(repo: string): string {
  return join(repo, '.claude', 'worktrees', 'baton')
}

export async function prepareSlot(git: Git, repo: string, task: string, vacate: () => Promise<void> = async () => {}): Promise<TaskPlace> {
  const place = taskPlace(repo, task)
  const path = slotPath(repo)
  const [own, slot] = await worktreesAt(git, repo, [place.path, path])
  if (own !== undefined) return { path: place.path, branch: own.branch }
  if (slot === undefined) await must(git, repo, ['worktree', 'add', '--detach', path, 'main'], 'add the slot to')
  else if (isTaskBranch(slot.branch, task)) return { path, branch: slot.branch }

  const status = await must(git, path, ['status', '--porcelain'], 'read the status of')
  if (status.out !== '') {
    throw new Error(`git: the slot ${path} has uncommitted changes, ${task} was not started; commit or remove them, then resume:\n${status.out}`)
  }
  await vacate()
  await must(git, path, ['clean', '-fd'], 'clean')
  const args = (await hasBranch(git, repo, place.branch)) ? ['switch', place.branch] : ['switch', '-c', place.branch, 'main']
  await must(git, path, args, `switch to ${place.branch} in`)
  return { path, branch: place.branch }
}

export async function finishSlot(git: Git, repo: string, task: string): Promise<FinishOutcome> {
  const place = taskPlace(repo, task)
  const path = slotPath(repo)
  const [own, slot] = await worktreesAt(git, repo, [place.path, path])
  if (own !== undefined) return finishWorktree(git, repo, task)

  if (slot === undefined || !isTaskBranch(slot.branch, task)) {
    return dropBranch(git, repo, task, (await hasBranch(git, repo, place.branch)) ? place.branch : null, [])
  }
  const kept = await leaveBranch(git, path)
  if (kept === null) return dropBranch(git, repo, task, slot.branch, [])
  return dropBranch(git, repo, task, null, [`${task}: the slot ${path} was kept on ${slot.branch}: ${kept}`])
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
