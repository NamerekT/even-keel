import type { Git } from './types.js'
import { must } from './worktree.js'

// A branch counts as merged once the main branch contains its tip and at least one commit the branch made itself.
// Own commits are read from the branch reflog: creation, resets and fast-forwards (catching up with main)
// add none, so a branch that only followed main is not taken for merged. Without a reflog it never is.
export async function branchMerged(git: Git, repo: string, task: string, main = 'main'): Promise<boolean> {
  return (await mergedCommits(git, repo, task, main)).length > 0
}

/**
 * The newest own commit main has of each merged branch of the task, as `branchMerged` counts them; none — not merged.
 * A later merge of the branch names a newer one, while catching up with main keeps it (BTN-689). `into` — the refs
 * that must all have it, the local main by default.
 */
export async function mergedCommits(git: Git, repo: string, task: string, main = 'main', into: string[] = [main]): Promise<string[]> {
  const listed = await must(git, repo, ['for-each-ref', '--format=%(refname)', `refs/heads/${task.toLowerCase()}/`], 'listBranches')
  const found: string[] = []
  for (const ref of listed.out.split(/\r?\n/).filter(Boolean)) {
    if (!(await inAll(git, repo, ref, into))) continue
    const reflog = await git(repo, ['reflog', 'show', '--format=%H %gs', ref, '--'])
    if (reflog.code !== 0) continue
    for (const line of reflog.out.split(/\r?\n/).filter(Boolean)) {
      const [commit, subject] = [line.slice(0, line.indexOf(' ')), line.slice(line.indexOf(' ') + 1)]
      if (madeOnBranch(subject) && (await inAll(git, repo, commit, into))) {
        found.push(commit)
        break
      }
    }
  }
  return found
}

/**
 * The oldest own commit each branch of the task still has that `landed` lacks, as `mergedCommits` reads them: a main
 * holding none of the task's unlanded work holds none of these either, even past a merge that fast-forwarded main over
 * every commit of the branch. `landed` — the refs that already have what an earlier landing pushed.
 */
export async function firstCommits(git: Git, repo: string, task: string, landed: string[]): Promise<string[]> {
  const listed = await must(git, repo, ['for-each-ref', '--format=%(refname)', `refs/heads/${task.toLowerCase()}/`], 'listBranches')
  const found: string[] = []
  for (const ref of listed.out.split(/\r?\n/).filter(Boolean)) {
    const reflog = await git(repo, ['reflog', 'show', '--format=%H %gs', ref, '--'])
    if (reflog.code !== 0) continue
    for (const line of reflog.out.split(/\r?\n/).filter(Boolean).reverse()) {
      const [commit, subject] = [line.slice(0, line.indexOf(' ')), line.slice(line.indexOf(' ') + 1)]
      if (madeOnBranch(subject) && (await inAll(git, repo, commit, [ref])) && !(await inAll(git, repo, commit, landed))) {
        found.push(commit)
        break
      }
    }
  }
  return found
}

/**
 * The task's own commits that have landed (BTN-1581): in the main of every remote of the checkout, as its last fetch or
 * push saw it. A checkout without a remote, or a project in PR mode, whose forge lands the branch, goes by the local main.
 */
export async function landedCommits(git: Git, repo: string, task: string, main = 'main', pullRequests = false): Promise<string[]> {
  const remotes = pullRequests ? [] : await remotesOf(git, repo)
  return mergedCommits(git, repo, task, main, remotes.length === 0 ? [main] : remotes.map((remote) => remoteMain(remote, main)))
}

/** Whether the release commit of a carry has landed, as `landedCommits` counts it. */
export async function landedCommit(git: Git, repo: string, commit: string, main = 'main'): Promise<boolean> {
  const remotes = await remotesOf(git, repo)
  return inAll(git, repo, commit, remotes.length === 0 ? [`refs/heads/${main}`] : remotes.map((remote) => remoteMain(remote, main)))
}

export async function remotesOf(git: Git, repo: string): Promise<string[]> {
  return (await git(repo, ['remote'])).out.split(/\s+/).filter(Boolean)
}

export const remoteMain = (remote: string, main: string): string => `refs/remotes/${remote}/${main}`

function madeOnBranch(subject: string): boolean {
  return !/^(branch|reset):/.test(subject) && !/Fast-forward$/.test(subject)
}

/** A ref missing from the checkout — a remote never fetched, or one without the main branch — has nothing. */
export async function inAll(git: Git, repo: string, commit: string, refs: string[]): Promise<boolean> {
  for (const ref of refs) if ((await git(repo, ['merge-base', '--is-ancestor', commit, ref])).code !== 0) return false
  return true
}
