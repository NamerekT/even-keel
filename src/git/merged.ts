import type { Git } from './types.js'
import { must } from './worktree.js'

// A branch counts as merged once main contains its tip and at least one commit the branch made itself.
// Own commits are read from the branch reflog: creation, resets and fast-forwards (catching up with main)
// add none, so a branch that only followed main is not taken for merged. Without a reflog it never is.
export async function branchMerged(git: Git, repo: string, task: string): Promise<boolean> {
  const listed = await must(git, repo, ['for-each-ref', '--format=%(refname)', `refs/heads/${task.toLowerCase()}/`], 'listBranches')
  for (const ref of listed.out.split(/\r?\n/).filter(Boolean)) {
    if (!(await inMain(git, repo, ref))) continue
    const reflog = await git(repo, ['reflog', 'show', '--format=%H %gs', ref, '--'])
    if (reflog.code !== 0) continue
    for (const line of reflog.out.split(/\r?\n/).filter(Boolean)) {
      const [commit, subject] = [line.slice(0, line.indexOf(' ')), line.slice(line.indexOf(' ') + 1)]
      if (madeOnBranch(subject) && (await inMain(git, repo, commit))) return true
    }
  }
  return false
}

function madeOnBranch(subject: string): boolean {
  return !/^(branch|reset):/.test(subject) && !/Fast-forward$/.test(subject)
}

async function inMain(git: Git, repo: string, commit: string): Promise<boolean> {
  return (await git(repo, ['merge-base', '--is-ancestor', commit, 'main'])).code === 0
}
