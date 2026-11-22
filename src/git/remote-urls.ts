import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type { Git, GitResult } from './types.js'

export const REMOTE_URLS_ARGS = ['config', '--get-regexp', '^remote\\..*\\.url$']

interface Entry {
  stamp: string
  result: Promise<GitResult>
}

/** By git runner, so a test's fake never answers from another's cache. */
const caches = new WeakMap<Git, Map<string, Entry>>()

/**
 * `git config --get-regexp ^remote\..*\.url$` in `repo`, read again only when the checkout's config files change
 * (BTN-1484): the service asks on every pass, git's answer changes only with `.git/config`. The stamp is the inode, mtime
 * and size of the common `config` and the worktree's `config.worktree`, found without git (a worktree's `.git` is a file
 * with `gitdir:`, its config is in `commondir`). A folder with no `.git` of its own, or one the stamp cannot read, asks
 * git every time. Remotes from a global or an `include.path` file are not watched: a change there waits for one of
 * the checkout's own files to change.
 */
export async function remoteUrls(git: Git, repo: string): Promise<GitResult> {
  const stamp = await configStamp(repo)
  if (stamp === null) return git(repo, REMOTE_URLS_ARGS)
  let cache = caches.get(git)
  if (cache === undefined) caches.set(git, (cache = new Map()))
  const known = cache.get(repo)
  if (known?.stamp === stamp) return known.result
  const result = git(repo, REMOTE_URLS_ARGS)
  const entry = { stamp, result }
  cache.set(repo, entry)
  // Exit 1 is "no remote": as much an answer as a list. Anything else is asked again.
  result.then(
    (answer) => answer.code !== 0 && answer.code !== 1 && cache.get(repo) === entry && cache.delete(repo),
    () => cache.get(repo) === entry && cache.delete(repo),
  )
  return result
}

/** The mtime and size of the config files git reads for `repo`; null when `repo` holds no `.git` or it cannot be read. */
export async function configStamp(repo: string): Promise<string | null> {
  try {
    const dotGit = join(repo, '.git')
    const gitDir = (await stat(dotGit)).isDirectory() ? dotGit : await linkedGitDir(repo, dotGit)
    if (gitDir === null) return null
    const commonDir = await readFile(join(gitDir, 'commondir'), 'utf8').then(
      (text) => absolute(gitDir, text.trim()),
      () => gitDir,
    )
    const config = await stat(join(commonDir, 'config'))
    const worktree = gitDir === commonDir ? null : await stat(join(gitDir, 'config.worktree')).catch(() => null)
    // Git writes its config into a lock file renamed over the old one: a new inode on every write, whatever the clock.
    return [commonDir, config.ino, config.mtimeMs, config.size, worktree?.ino, worktree?.mtimeMs, worktree?.size].join('|')
  } catch {
    return null
  }
}

async function linkedGitDir(repo: string, dotGit: string): Promise<string | null> {
  const match = /^gitdir:\s*(.+?)\s*$/m.exec(await readFile(dotGit, 'utf8'))
  return match === null ? null : absolute(repo, match[1]!)
}

const absolute = (base: string, path: string): string => (isAbsolute(path) ? path : resolve(base, path))
