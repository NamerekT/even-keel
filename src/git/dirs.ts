import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

export interface GitDirs {
  /** The checkout's own folder: `.git`, or a linked worktree's `.git/worktrees/<name>`. */
  gitDir: string
  /** Where the config, the refs and `packed-refs` are: `gitDir` itself unless it has a `commondir`. */
  commonDir: string
}

/**
 * The git folders of `repo`, found without git: a worktree's `.git` is a file with `gitdir:`, its common folder is in
 * `commondir`. Null when `repo` holds no `.git` of its own; throws when it cannot be read.
 */
export async function gitDirs(repo: string): Promise<GitDirs | null> {
  const dotGit = join(repo, '.git')
  const gitDir = (await stat(dotGit)).isDirectory() ? dotGit : await linkedGitDir(repo, dotGit)
  if (gitDir === null) return null
  const commonDir = await readFile(join(gitDir, 'commondir'), 'utf8').then(
    (text) => absolute(gitDir, text.trim()),
    () => gitDir,
  )
  return { gitDir, commonDir }
}

async function linkedGitDir(repo: string, dotGit: string): Promise<string | null> {
  const match = /^gitdir:\s*(.+?)\s*$/m.exec(await readFile(dotGit, 'utf8'))
  return match === null ? null : absolute(repo, match[1]!)
}

const absolute = (base: string, path: string): string => (isAbsolute(path) ? path : resolve(base, path))
