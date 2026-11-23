import { moveCheckout, readBranches } from '../git/branches.js'
import type { Git } from '../git/types.js'
import { fail } from '../notice/notice.js'
import { branchMove, type BranchShift, type RepoBranches } from './branch.js'

/**
 * Puts the main checkout on `branch` (BTN-754), then `write`s the setting: git refuses first, and the config stays as it
 * was; a write that fails puts the checkout back where it stood. `known` — the branches already read, else read here;
 * `project` names the project in a refusal.
 */
export async function moveBranch<T>(git: Git, repo: string, known: RepoBranches | null, branch: string, write: () => T, project = ''): Promise<T> {
  const shift = await shiftBranch(git, repo, known, branch, project)
  try {
    return write()
  } catch (error) {
    await shiftBack(git, repo, branch, shift)
    throw error
  }
}

/** Puts a checkout on `branch` by `branchMove`: what it did, for `shiftBack`. */
export async function shiftBranch(git: Git, repo: string, known: RepoBranches | null, branch: string, project = ''): Promise<BranchShift> {
  const before = known ?? (await readBranches(git, repo))
  if (before === null) throw fail('branch.noRepo', { project })
  const move = branchMove(before, branch)
  await moveCheckout(git, repo, branch, move)
  return { before, move }
}

/** Undoes `shiftBranch`: the checkout goes back where it stood, and a branch the move made is dropped again. */
export async function shiftBack(git: Git, repo: string, branch: string, { before, move }: BranchShift): Promise<void> {
  if (move.kind === 'stay') return
  const back = before.current === null ? ['switch', '--detach', before.head ?? 'HEAD@{1}'] : ['switch', before.current]
  const switched = await git(repo, back)
  if (switched.code !== 0) {
    console.warn(`git: ${repo} was not put back after a failed move (git ${back.join(' ')}): ${switched.out}`)
    return
  }
  // A branch this move made has nothing of its own yet.
  if (move.kind !== 'switch') {
    const dropped = await git(repo, ['branch', '-D', branch])
    if (dropped.code !== 0) console.warn(`git: ${repo} kept the branch ${branch} made before a failed move: ${dropped.out}`)
  }
  console.log(`git: ${repo} is put back on ${before.current ?? before.head} after a failed move`)
}
