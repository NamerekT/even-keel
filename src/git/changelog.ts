import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fail } from '../notice/notice.js'
import type { Git } from './types.js'

export interface ChangelogCommit {
  /** The project's main branch: the checkout must be on it. */
  branch: string
  /** The file, relative to the repository's root, with forward slashes. */
  path: string
  message: string
  /** The new text of the file from its text now (`null` — there is none), both with LF line ends. */
  change: (text: string | null) => string
}

/**
 * Writes the changelog in the project's main checkout and commits that file alone to the main branch (BTN-209): left
 * uncommitted, it would stop a session's merge and the `git sync` after Done. Refused when the checkout is on another
 * branch or the file already has changes of its own. The file keeps its CRLF line ends. The commit's sha; `null` — the
 * text did not change, nothing was committed.
 */
export async function commitChangelog(git: Git, repo: string, commit: ChangelogCommit): Promise<string | null> {
  const current = (await git(repo, ['branch', '--show-current'])).out.trim()
  if (current !== commit.branch) throw fail('changelog.notOnBranch', { branch: commit.branch, current })
  const status = await git(repo, ['status', '--porcelain', '--', commit.path])
  if (status.code !== 0 || status.out.trim() !== '') throw fail('changelog.dirty', { file: commit.path }, { detail: status.out || undefined })

  const file = join(repo, ...commit.path.split('/'))
  const before = existsSync(file) ? readFileSync(file, 'utf8') : null
  const crlf = before?.includes('\r\n') ?? false
  const after = commit.change(before?.replace(/\r\n/g, '\n') ?? null)
  const text = crlf ? after.replace(/\r?\n/g, '\r\n') : after
  if (text === before) return null
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)

  const added = await git(repo, ['add', '--', commit.path])
  const committed = added.code === 0 ? await git(repo, ['commit', '-q', '-m', commit.message, '--', commit.path]) : added
  if (committed.code !== 0) {
    // A refused commit (a hook, say) leaves the checkout as it found it.
    await git(repo, ['reset', '-q', '--', commit.path])
    if (before === null) rmSync(file, { force: true })
    else writeFileSync(file, before)
    throw fail('changelog.commitFailed', { file: commit.path }, { detail: committed.out })
  }
  return (await git(repo, ['rev-parse', 'HEAD'])).out.trim()
}
