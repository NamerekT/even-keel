import { appendFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
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

export async function ensureIgnored(git: Git, repo: string): Promise<void> {
  const probe = await git(repo, ['check-ignore', '-q', `${WORKTREES}probe`])
  if (probe.code === 0) return
  if (probe.code !== 1) throw new Error(`git: cannot tell whether ${repo} ignores ${WORKTREES}: ${probe.out}`)
  const file = resolve(repo, (await must(git, repo, ['rev-parse', '--git-path', 'info/exclude'], 'find the exclude file of')).out)
  let text = ''
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  appendFileSync(file, `${text === '' || text.endsWith('\n') ? '' : '\n'}${WORKTREES}\n`)
}

export async function prepareWorktree(git: Git, repo: string, task: string): Promise<TaskPlace> {
  const place = taskPlace(repo, task)
  const found = await worktreeAt(git, repo, place.path)
  if (found !== undefined) return { path: place.path, branch: found.branch }
  const args = (await hasBranch(git, repo, place.branch))
    ? ['worktree', 'add', place.path, place.branch]
    : ['worktree', 'add', '-b', place.branch, place.path, 'main']
  await must(git, repo, args, `add the worktree of ${task} to`)
  return place
}

export async function finishWorktree(git: Git, repo: string, task: string): Promise<FinishOutcome> {
  const place = taskPlace(repo, task)
  const warnings: string[] = []
  const found = await worktreeAt(git, repo, place.path)
  let branch = found === undefined ? ((await hasBranch(git, repo, place.branch)) ? place.branch : null) : found.branch
  if (branch !== null && !branch.startsWith(`${task.toLowerCase()}/`)) branch = null

  if (found !== undefined) {
    const removed = await git(repo, ['worktree', 'remove', place.path])
    if (removed.code !== 0) {
      if ((await worktreeAt(git, repo, place.path)) === undefined) {
        warnings.push(`${task}: the worktree folder ${place.path} was left behind, a process still holds it: ${removed.out}`)
      } else {
        warnings.push(`${task}: the worktree ${place.path} was kept: ${removed.out}`)
        branch = null
      }
    }
  }

  return dropBranch(git, repo, task, branch, warnings)
}

export async function dropBranch(git: Git, repo: string, task: string, branch: string | null, warnings: string[]): Promise<FinishOutcome> {
  let gone: string | null = null
  if (branch !== null) {
    const deleted = await git(repo, ['branch', '-d', branch])
    if (deleted.code === 0) gone = branch
    else warnings.push(`${task}: the branch ${branch} was kept: ${deleted.out}`)
  }

  const remotes = (await must(git, repo, ['remote'], 'list the remotes of')).out.split(/\s+/).filter(Boolean)
  if (gone !== null && remotes.includes('origin')) {
    const warning = await deleteOnOrigin(git, repo, gone)
    if (warning !== null) warnings.push(`${task}: ${warning}`)
  }

  if (remotes.length === 0) return { warnings, syncError: null }
  const synced = await git(repo, ['sync'])
  return { warnings, syncError: synced.code === 0 ? null : synced.out || `git sync exited with ${synced.code}` }
}

async function deleteOnOrigin(git: Git, repo: string, branch: string): Promise<string | null> {
  const listed = await git(repo, ['ls-remote', '--exit-code', '--heads', 'origin', `refs/heads/${branch}`])
  if (listed.code === 2) return null
  if (listed.code !== 0) return `could not check the branch ${branch} on origin: ${listed.out}`
  const pushed = await git(repo, ['push', 'origin', '--delete', branch])
  return pushed.code === 0 ? null : `the branch ${branch} was kept on origin: ${pushed.out}`
}

export async function worktreeAt(git: Git, repo: string, path: string): Promise<Worktree | undefined> {
  return (await worktreesAt(git, repo, [path]))[0]
}

export async function worktreesAt(git: Git, repo: string, paths: string[]): Promise<(Worktree | undefined)[]> {
  await git(repo, ['worktree', 'prune'])
  const trees = parseWorktrees((await must(git, repo, ['worktree', 'list', '--porcelain'], 'list the worktrees of')).out)
  return paths.map((path) => trees.find((tree) => samePath(tree.path, path)))
}

export async function hasBranch(git: Git, repo: string, branch: string): Promise<boolean> {
  return (await git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])).code === 0
}

export async function must(git: Git, repo: string, args: string[], what: string): Promise<GitResult> {
  const result = await git(repo, args)
  if (result.code !== 0) throw new Error(`git: could not ${what} ${repo}: ${result.out}`)
  return { ...result, out: result.out.trim() }
}

function samePath(a: string, b: string): boolean {
  return resolve(a).toLowerCase() === resolve(b).toLowerCase()
}
