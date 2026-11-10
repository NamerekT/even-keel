import { statSync } from 'node:fs'
import { requireStarted } from '../git/setup.js'
import type { Git } from '../git/types.js'
import { ensureIgnored, parseWorktrees, requireBranch } from '../git/worktree.js'
import { fail, notice, type Notice } from '../notice/notice.js'
import { samePath } from '../paths.js'
import type { RemovalFacts } from './removal.js'

const FIRST_COMMIT = 'Initial commit'

/**
 * Makes the folder of a project without git a repository on `branch` (BTN-884): `git init`, Even Keel's folders in
 * `info/exclude`, then a first commit of everything already there. A folder that is a repository of its own with commits
 * is only checked for the branch; `made` — whether the first commit was made here.
 */
export async function turnGitOn(git: Git, folder: string, project: string, branch: string): Promise<{ made: boolean }> {
  if (!isFolder(folder)) throw fail('wizard.noFolder', { path: folder })
  if (requireStarted(await git(folder, ['check-ref-format', '--branch', branch])).code !== 0) throw fail('wizard.branchName', { value: branch })
  // The folder may sit inside another repository: only a repository whose top is the folder itself is the project's.
  const top = await git(folder, ['rev-parse', '--show-toplevel'])
  const own = top.code === 0 && samePath(top.out.trim(), folder)
  if (own && (await git(folder, ['rev-parse', '--verify', '--quiet', 'HEAD'])).code === 0) {
    await requireBranch(git, folder, project, branch)
    await ensureIgnored(git, folder)
    return { made: false }
  }
  const [name, email] = await Promise.all(['user.name', 'user.email'].map((key) => configValue(git, folder, key)))
  if (name === null || email === null) throw fail('git.noIdentity', {})
  const must = async (args: string[]) => {
    const result = requireStarted(await git(folder, args))
    if (result.code !== 0) throw fail('git.initFailed', { path: folder }, { detail: result.out })
  }
  await must(own ? ['symbolic-ref', 'HEAD', `refs/heads/${branch}`] : ['init', '-b', branch])
  await ensureIgnored(git, folder)
  await must(['add', '-A'])
  await must(['commit', '--allow-empty', '-m', FIRST_COMMIT])
  return { made: true }
}

/** The worktrees of the project's repository besides its main checkout: work of tasks that turning git off leaves behind. */
export async function taskWorktrees(git: Git, folder: string): Promise<string[]> {
  const listed = await git(folder, ['worktree', 'list', '--porcelain'])
  if (listed.code !== 0) return []
  return parseWorktrees(listed.out)
    .map((each) => each.path)
    .filter((path) => !samePath(path, folder))
}

/**
 * Why the project's git mode cannot be switched now, each reason an item; `null` — it can. A chain may run, but only
 * between tasks: no task in hand, no live session, no worktree or slot it holds.
 */
export function gitSwitchBlock(facts: Pick<RemovalFacts, 'project' | 'sessions' | 'held'>, inHand: string | null): Notice | null {
  const items: Notice[] = []
  if (inHand !== null) items.push(notice('project.gitTaskInHand', { task: inHand }))
  if (facts.sessions.length > 0) items.push(notice('project.removeSessions', { sessions: facts.sessions }))
  if (facts.held.length > 0) items.push(notice('project.removePlaces', { tasks: facts.held }))
  return items.length === 0 ? null : notice('project.gitBusy', { project: facts.project }, { items })
}

async function configValue(git: Git, cwd: string, key: string): Promise<string | null> {
  const read = requireStarted(await git(cwd, ['config', '--get', key]))
  const value = read.code === 0 ? read.out.trim() : ''
  return value === '' ? null : value
}

function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
