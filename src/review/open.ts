import { readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { CiTarget, Remote } from '../ci/remote.js'
import { parseRemote } from '../ci/remote.js'
import type { Git } from '../git/types.js'
import { fail } from '../notice/notice.js'
import type { Forge, PullRef } from './model.js'

/** The remote a project's pull requests go to: `origin` if its address parses, else the first one that does (BTN-205). */
export function pullTarget(remotes: Remote[]): CiTarget | null {
  const parsed = remotes.flatMap(({ name, url }) => {
    const repo = parseRemote(url)
    return repo === null ? [] : [{ name, repo }]
  })
  const chosen = parsed.find(({ name }) => name === 'origin') ?? parsed[0]
  if (chosen === undefined) return null
  const { host, ...repo } = chosen.repo
  return { kind: host === 'github.com' ? 'github' : 'forgejo', remote: chosen.name, ...repo }
}

/** The pull request's title and body from the session's note: the first line that is not blank, then the rest. */
export function describedBy(note: string): { title: string; body: string } | null {
  const lines = note.replace(/\r\n/g, '\n').split('\n')
  const first = lines.findIndex((line) => line.trim() !== '')
  if (first === -1) return null
  const title = lines[first]!.replace(/^#+\s*/, '').trim()
  return { title, body: lines.slice(first + 1).join('\n').trim() }
}

export interface Opened extends PullRef {
  branch: string
  pushedAt: string
}

/**
 * Pushes the branch the session's folder is on and opens its pull request, or finds the one already open: a session
 * that fixed what the review asked marks again, and its branch goes to the same pull request.
 */
export async function openPull(git: Git, workdir: string, note: string, remote: string, forge: Forge, base: string, now: () => Date): Promise<Opened> {
  const branch = (await git(workdir, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).out.trim()
  if (branch === '') throw fail('review.noBranch', { path: workdir })
  const status = await git(workdir, ['status', '--porcelain', '--untracked-files=no'])
  if (status.code !== 0 || status.out.trim() !== '') throw fail('review.dirty', { path: workdir }, { detail: status.out })
  const notePath = isAbsolute(note) ? note : join(workdir, note)
  const described = describedBy(await readFile(notePath, 'utf8').catch(() => ''))
  if (described === null) throw fail('review.noNote', { path: notePath })

  const pushed = await git(workdir, ['push', '--set-upstream', remote, `${branch}:refs/heads/${branch}`])
  if (pushed.code !== 0) throw fail('review.pushFailed', { branch, remote }, { detail: pushed.out })
  const pushedAt = now().toISOString()
  const pull = (await forge.find(branch)) ?? (await forge.create({ branch, base, ...described }))
  return { ...pull, branch, pushedAt }
}
