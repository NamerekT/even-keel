import type { Git } from './types.js'
import { must } from './worktree.js'

// A branch counts as merged once main contains its tip and the tip has moved since the branch was created,
// so a fresh branch that main has simply passed is not taken for a merged one. The start is the oldest
// entry of the branch reflog; without a reflog the branch is never taken for merged.
export async function branchMerged(git: Git, repo: string, task: string): Promise<boolean> {
  const listed = await must(git, repo, ['for-each-ref', '--format=%(refname) %(objectname)', `refs/heads/${task.toLowerCase()}/`], 'listBranches')
  for (const line of listed.out.split(/\r?\n/).filter(Boolean)) {
    const [ref, tip] = line.split(' ') as [string, string]
    if ((await git(repo, ['merge-base', '--is-ancestor', ref, 'main'])).code !== 0) continue
    const reflog = await git(repo, ['reflog', 'show', '--format=%H', ref, '--'])
    const start = reflog.code === 0 ? reflog.out.split(/\r?\n/).filter(Boolean).at(-1) : undefined
    if (start !== undefined && start !== tip) return true
  }
  return false
}
