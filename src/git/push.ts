import type { Git } from './types.js'

/** The remote a task's branch goes to (BTN-1270): `origin` when the repository has one, else its first remote; `null` — none. */
export function taskRemote(remotes: readonly string[]): string | null {
  return remotes.includes('origin') ? 'origin' : (remotes[0] ?? null)
}

/** What a push of a task's branch did; `failed` — git's output of a refused push. */
export type BranchPush = { remote: string; branch: string; failed?: string } | { skipped: 'noBranch' | 'noRemote' }

/**
 * Pushes the task's branch of a working folder to the remote (BTN-1270, `docs/chain/worktrees.md`, "Task branches on
 * the remote"): only a folder on a branch `<task>/…`, and never forced, so a branch on the remote with commits the
 * folder lacks stays as it is.
 */
export async function pushTaskBranch(git: Git, folder: string, task: string): Promise<BranchPush> {
  const head = await git(folder, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  const branch = head.out.trim()
  if (head.code !== 0 || !branch.startsWith(`${task.toLowerCase()}/`)) return { skipped: 'noBranch' }
  const remote = await remoteOf(git, folder)
  if (remote === null) return { skipped: 'noRemote' }
  const pushed = await git(folder, ['push', remote, `${branch}:refs/heads/${branch}`])
  return pushed.code === 0 ? { remote, branch } : { remote, branch, failed: pushed.out }
}

/** The repository's `taskRemote`; `null` — it has none. */
export async function remoteOf(git: Git, repo: string): Promise<string | null> {
  const listed = await git(repo, ['remote'])
  return listed.code === 0 ? taskRemote(listed.out.split(/\s+/).filter(Boolean)) : null
}

/** Whether the remote has the branch; `{ error }` — the remote did not answer. */
export async function remoteHas(git: Git, repo: string, remote: string, branch: string): Promise<boolean | { error: string }> {
  const listed = await git(repo, ['ls-remote', '--exit-code', '--heads', remote, `refs/heads/${branch}`])
  return listed.code === 0 ? true : listed.code === 2 ? false : { error: listed.out.trim() || `git exited with ${listed.code}` }
}

/**
 * Brings a moved task's branch from the remote into the repository (BTN-1270), so the worktree is prepared from it: a
 * local branch of that name is moved to the remote's, a folder holding it checked out makes git refuse. `null` — done,
 * else git's output.
 */
export async function restoreBranch(git: Git, repo: string, branch: string): Promise<string | null> {
  const remote = await remoteOf(git, repo)
  if (remote === null) return 'the repository has no remote'
  const fetched = await git(repo, ['fetch', remote, `+refs/heads/${branch}:refs/heads/${branch}`])
  return fetched.code === 0 ? null : fetched.out.trim() || `git exited with ${fetched.code}`
}
