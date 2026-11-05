import { moveCheckout, readBranches } from '../git/branches.js'
import type { Git } from '../git/types.js'
import { fail } from '../notice/notice.js'
import { branchMove, type BranchMove, type RepoBranches } from './branch.js'

/**
 * Puts the main checkout on `branch` (BTN-754), then `write`s the setting: git refuses first, and the config stays as it
 * was; a write that fails puts the checkout back where it stood. `known` — the branches already read, else read here;
 * `project` names the project in a refusal.
 */
export async function moveBranch<T>(git: Git, repo: string, known: RepoBranches | null, branch: string, write: () => T, project = ''): Promise<T> {
  const branches = known ?? (await readBranches(git, repo))
  if (branches === null) throw fail('branch.noRepo', { project })
  const move = branchMove(branches, branch)
  await moveCheckout(git, repo, branch, move)
  try {
    return write()
  } catch (error) {
    await putBack(git, repo, branches, branch, move)
    throw error
  }
}

async function putBack(git: Git, repo: string, before: RepoBranches, branch: string, move: BranchMove): Promise<void> {
  if (move.kind === 'stay') return
  const back = before.current === null ? ['switch', '--detach', before.head ?? 'HEAD@{1}'] : ['switch', before.current]
  const switched = await git(repo, back)
  if (switched.code !== 0) {
    console.warn(`git: ${repo} was not put back after a failed write (git ${back.join(' ')}): ${switched.out}`)
    return
  }
  // A branch this move made is dropped again: it has nothing of its own yet.
  if (move.kind !== 'switch') {
    const dropped = await git(repo, ['branch', '-D', branch])
    if (dropped.code !== 0) console.warn(`git: ${repo} kept the branch ${branch} made before a failed write: ${dropped.out}`)
  }
  console.log(`git: ${repo} is put back on ${before.current ?? before.head} after a failed write`)
}
