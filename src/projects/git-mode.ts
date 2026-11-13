import { statSync } from 'node:fs'
import { requireStarted } from '../git/setup.js'
import type { Git } from '../git/types.js'
import { ensureIgnored, must, requireBranch, requireCheckedOut } from '../git/worktree.js'
import { fail, notice, type Notice } from '../notice/notice.js'
import { samePath } from '../paths.js'
import type { RemovalFacts } from './removal.js'

const FIRST_COMMIT = 'Initial commit'
const LOOSE_COMMIT = 'Work done without git'

/**
 * Makes the folder of a project without git a repository on `branch` (BTN-884): `git init`, Even Keel's folders in
 * `info/exclude`, then a first commit of everything already there; `made` — whether the first commit was made here.
 * A folder that is a repository of its own with commits is checked for the branch, and the work done in it while git
 * was off (BTN-1054) goes into one commit on that branch with `commit`, or refuses the switch without it; `committed` —
 * whether that commit was made. The status is read here, at the press, not when the page asked for it.
 */
export async function turnGitOn(
  git: Git,
  folder: string,
  project: string,
  branch: string,
  { commit = false }: { commit?: boolean } = {},
): Promise<{ made: boolean; committed: boolean }> {
  if (!isFolder(folder)) throw fail('wizard.noFolder', { path: folder })
  if (requireStarted(await git(folder, ['check-ref-format', '--branch', branch])).code !== 0) throw fail('wizard.branchName', { value: branch })
  const own = await ownRepository(git, folder)
  if (own && (await hasCommits(git, folder))) {
    await requireBranch(git, folder, project, branch)
    await ensureIgnored(git, folder)
    const files = await statusLines(git, folder)
    if (files.length === 0) return { made: false, committed: false }
    await requireCheckedOut(git, folder, project, branch)
    if (!commit) throw fail('project.gitDirty', { project, files })
    await requireIdentity(git, folder)
    await must(git, folder, ['add', '-A'], 'commit')
    await must(git, folder, ['commit', '-m', LOOSE_COMMIT], 'commit')
    return { made: false, committed: true }
  }
  await requireIdentity(git, folder)
  const run = async (args: string[]) => {
    const result = requireStarted(await git(folder, args))
    if (result.code !== 0) throw fail('git.initFailed', { path: folder }, { detail: result.out })
  }
  await run(own ? ['symbolic-ref', 'HEAD', `refs/heads/${branch}`] : ['init', '-b', branch])
  await ensureIgnored(git, folder)
  await run(['add', '-A'])
  await run(['commit', '--allow-empty', '-m', FIRST_COMMIT])
  return { made: true, committed: false }
}

/**
 * What turning git on would commit as work done without git, as `git status --porcelain` lines with Even Keel's folders
 * left out (it writes them into `info/exclude`, as the switch would). Only a repository of its own with commits has
 * any: elsewhere the first commit takes everything anyway.
 */
export async function uncommittedChanges(git: Git, folder: string): Promise<string[]> {
  if (!isFolder(folder) || !(await ownRepository(git, folder)) || !(await hasCommits(git, folder))) return []
  await ensureIgnored(git, folder)
  return statusLines(git, folder)
}

/** The folder may sit inside another repository: only a repository whose top is the folder itself is the project's. */
export async function ownRepository(git: Git, folder: string): Promise<boolean> {
  const top = await git(folder, ['rev-parse', '--show-toplevel'])
  return top.code === 0 && samePath(top.out.trim(), folder)
}

async function hasCommits(git: Git, folder: string): Promise<boolean> {
  return (await git(folder, ['rev-parse', '--verify', '--quiet', 'HEAD'])).code === 0
}

/**
 * The changes as short lines, `M file.txt`, `?? new/`, `R old → new`. Read as porcelain v2: git's output comes
 * trimmed, and v1 would lose the leading space of the first line's status.
 */
async function statusLines(git: Git, folder: string): Promise<string[]> {
  const read = await must(git, folder, ['-c', 'core.quotePath=false', 'status', '--porcelain=v2'], 'readStatus')
  return read.out.split(/\r?\n/).flatMap((line) => {
    if (line.startsWith('? ')) return [`?? ${line.slice(2)}`]
    const fields = STATUS_FIELDS[line[0] ?? '']
    if (fields === undefined) return []
    const parts = line.split(' ')
    const path = parts.slice(fields).join(' ').split('\t').reverse().join(' → ')
    return [`${parts[1]!.replaceAll('.', '')} ${path}`]
  })
}

/** Fields before the path in a porcelain v2 line: changed, renamed or copied, unmerged. */
const STATUS_FIELDS: Record<string, number> = { '1': 8, '2': 9, u: 10 }

async function requireIdentity(git: Git, folder: string): Promise<void> {
  const [name, email] = await Promise.all(['user.name', 'user.email'].map((key) => configValue(git, folder, key)))
  if (name === null || email === null) throw fail('git.noIdentity', {})
}

/**
 * Why git cannot be turned on for the project now, each reason an item; `null` — it can. A chain may run, but only
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
