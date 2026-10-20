import { appendFileSync, readFileSync } from 'node:fs'
import { lstat, readdir, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { GitStep } from '../notice/en.js'
import { fail, notice, type Notice } from '../notice/notice.js'
import { samePath } from '../paths.js'
import { syncMain } from './sync.js'
import type { FinishOutcome, Git, GitResult, TaskPlace } from './types.js'

export type { FinishOutcome, Git, GitResult, TaskPlace }

interface Worktree {
  path: string
  branch: string | null
}

const WORKTREES = '.claude/worktrees/'

export function taskPlace(repo: string, task: string): { path: string; branch: string } {
  const slug = task.toLowerCase()
  return { path: join(repo, '.claude', 'worktrees', slug), branch: `${slug}/task` }
}

export function parseWorktrees(text: string): Worktree[] {
  return text
    .split(/\r?\n\r?\n/)
    .map((block) => block.split(/\r?\n/))
    .flatMap((lines) => {
      const path = lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length)
      if (path === undefined) return []
      const branch = lines.find((line) => line.startsWith('branch refs/heads/'))?.slice('branch refs/heads/'.length) ?? null
      return [{ path, branch }]
    })
}

/** `.temp/` holds a session's scratch, the pull request's description among it: written there, it must not make the worktree dirty (BTN-221). */
const IGNORED = [WORKTREES, '.temp/']

export async function ensureIgnored(git: Git, repo: string): Promise<void> {
  const missing: string[] = []
  for (const dir of IGNORED) {
    const probe = await git(repo, ['check-ignore', '-q', `${dir}probe`])
    if (probe.code === 1) missing.push(dir)
    else if (probe.code !== 0) throw fail('git.ignoreUnknown', { repo, dir }, { detail: probe.out })
  }
  if (missing.length === 0) return
  const file = resolve(repo, (await must(git, repo, ['rev-parse', '--git-path', 'info/exclude'], 'excludeFile')).out)
  let text = ''
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  appendFileSync(file, `${text === '' || text.endsWith('\n') ? '' : '\n'}${missing.map((dir) => `${dir}\n`).join('')}`)
}

/** The project's main branch must be there before any task branches off it. */
export async function requireBranch(git: Git, repo: string, project: string, branch: string): Promise<void> {
  if (!(await hasBranch(git, repo, branch))) throw fail('git.noBranch', { project, branch, repo })
}

/** The merge, `git sync` and the search for the merged task all work on the project's branch: the main checkout must stand on it. */
export async function requireCheckedOut(git: Git, repo: string, project: string, branch: string): Promise<void> {
  const head = await git(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  const current = head.code === 0 && head.out.trim() !== '' ? head.out.trim() : null
  if (current !== branch) throw fail('git.wrongBranch', { project, branch, current, repo })
}

/**
 * `ahead` — the place is made before the launch, while the chain waits for main: a new one stays detached at main and
 * gets the task branch only at the launch, so whatever starts the task on the checkout of its branch (a tracker's git hook) does it then.
 */
export async function prepareWorktree(git: Git, repo: string, task: string, main = 'main', ahead = false): Promise<TaskPlace> {
  const place = taskPlace(repo, task)
  const found = await worktreeAt(git, repo, place.path)
  const branched = await hasBranch(git, repo, place.branch)
  if (found !== undefined) {
    if (found.branch !== null || ahead) return { path: place.path, branch: found.branch }
    await must(git, repo, ['-C', place.path, 'switch', ...(branched ? [] : ['-c']), place.branch], 'switch', place.branch)
    return place
  }
  const detached = ahead && !branched
  const args = branched
    ? ['worktree', 'add', place.path, place.branch]
    : detached
      ? ['worktree', 'add', '--detach', place.path, main]
      : ['worktree', 'add', '-b', place.branch, place.path, main]
  await must(git, repo, args, 'addWorktree', task)
  return detached ? { path: place.path, branch: null } : place
}

/**
 * Brings a prepared place up to the main branch while nothing of the task is in it yet: no commits of its own, no changes.
 * A task prepared while the chain waited for the CI then starts from the fix that came meanwhile. `true` — it moved.
 */
export async function catchUp(git: Git, path: string, main = 'main'): Promise<boolean> {
  const [own, behind, status] = await Promise.all([
    git(path, ['rev-list', '--count', `${main}..HEAD`]),
    git(path, ['rev-list', '--count', `HEAD..${main}`]),
    git(path, ['status', '--porcelain']),
  ])
  if (own.code !== 0 || behind.code !== 0 || status.code !== 0) return false
  if (own.out.trim() !== '0' || behind.out.trim() === '0' || status.out.trim() !== '') return false
  return (await git(path, ['merge', '--ff-only', main])).code === 0
}

/**
 * How a task's branch goes after it (BTN-205): `force` — deleted though not merged into main (the pull request was
 * merged on the forge, or closed); `remote` — the remote it was pushed to, `origin` by default.
 */
export interface BranchDrop {
  force?: boolean
  remote?: string
}

export async function finishWorktree(git: Git, repo: string, task: string, main = 'main', drop: BranchDrop = {}): Promise<FinishOutcome> {
  const place = taskPlace(repo, task)
  const warnings: Notice[] = []
  const found = await worktreeAt(git, repo, place.path)
  let branch = found === undefined ? ((await hasBranch(git, repo, place.branch)) ? place.branch : null) : found.branch
  if (branch !== null && !branch.startsWith(`${task.toLowerCase()}/`)) branch = null

  if (found !== undefined) {
    await unlinkIgnoredLinks(git, repo, place.path)
    const removed = await git(repo, ['worktree', 'remove', place.path])
    if (removed.code !== 0) {
      if ((await worktreeAt(git, repo, place.path)) === undefined) {
        warnings.push(notice('cleanup.folderLeft', { path: place.path }, { detail: removed.out }))
      } else {
        warnings.push(notice('cleanup.worktreeKept', { path: place.path }, { detail: removed.out }))
        branch = null
      }
    }
  }

  return dropBranch(git, repo, branch, warnings, main, drop)
}

/**
 * `git worktree remove` on Windows follows junctions: it empties a linked folder outside the worktree
 * (`npm link`) and stops at a dangling one (an npm workspace link whose package it already deleted),
 * leaving the folder behind. A clean worktree's links all sit in ignored folders, so they go first.
 */
async function unlinkIgnoredLinks(git: Git, repo: string, path: string): Promise<void> {
  const status = await git(repo, ['-C', path, 'status', '--porcelain', '-z', '--ignored'])
  const entries = status.out.split('\0').filter(Boolean)
  if (status.code !== 0 || entries.some((entry) => !entry.startsWith('!! '))) return
  try {
    for (const entry of entries) await unlinkLinks(join(path, entry.slice(3)))
  } catch {
    // git removes what is left, as it would without this step
  }
}

async function unlinkLinks(path: string): Promise<void> {
  const stat = await lstat(path)
  if (stat.isSymbolicLink()) return unlink(path)
  if (!stat.isDirectory()) return
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || entry.isDirectory()) await unlinkLinks(join(path, entry.name))
  }
}

export async function dropBranch(
  git: Git,
  repo: string,
  branch: string | null,
  warnings: Notice[],
  main = 'main',
  { force = false, remote = 'origin' }: BranchDrop = {},
): Promise<FinishOutcome> {
  let gone: string | null = null
  if (branch !== null) {
    const deleted = await git(repo, ['branch', force ? '-D' : '-d', branch])
    if (deleted.code === 0) gone = branch
    else warnings.push(notice('cleanup.branchKept', { branch }, { detail: deleted.out }))
  }

  const remotes = (await must(git, repo, ['remote'], 'listRemotes')).out.split(/\s+/).filter(Boolean)
  if (gone !== null && remotes.includes(remote)) {
    const warning = await deleteOnRemote(git, repo, remote, gone)
    if (warning !== null) warnings.push(warning)
  }

  if (remotes.length === 0) return { warnings, syncError: null }
  return { warnings, syncError: await syncMain(git, repo, remotes, main) }
}

async function deleteOnRemote(git: Git, repo: string, remote: string, branch: string): Promise<Notice | null> {
  const listed = await git(repo, ['ls-remote', '--exit-code', '--heads', remote, `refs/heads/${branch}`])
  if (listed.code === 2) return null
  if (listed.code !== 0) return notice('cleanup.originUnchecked', { branch, remote }, { detail: listed.out })
  const pushed = await git(repo, ['push', remote, '--delete', branch])
  return pushed.code === 0 ? null : notice('cleanup.originKept', { branch, remote }, { detail: pushed.out })
}

export async function worktreeAt(git: Git, repo: string, path: string): Promise<Worktree | undefined> {
  return (await worktreesAt(git, repo, [path]))[0]
}

export async function worktreesAt(git: Git, repo: string, paths: string[]): Promise<(Worktree | undefined)[]> {
  await git(repo, ['worktree', 'prune'])
  const trees = parseWorktrees((await must(git, repo, ['worktree', 'list', '--porcelain'], 'listWorktrees')).out)
  return paths.map((path) => trees.find((tree) => samePath(tree.path, path)))
}

export async function hasBranch(git: Git, repo: string, branch: string): Promise<boolean> {
  return (await git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])).code === 0
}

export async function must(git: Git, repo: string, args: string[], step: GitStep, subject = ''): Promise<GitResult> {
  const result = await git(repo, args)
  if (result.code !== 0) throw fail('git.failed', { step, subject, repo }, { detail: result.out })
  return { ...result, out: result.out.trim() }
}
