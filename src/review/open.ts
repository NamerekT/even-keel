import { readFile } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import type { CiTarget, Remote, UnsupportedRemote } from '../ci/remote.js'
import { gitlabRepo, parseRemote, remoteKind } from '../ci/remote.js'
import type { Git } from '../git/types.js'
import { fail, notice, type Notice } from '../notice/notice.js'
import type { Forge, Opened } from './model.js'

/**
 * The remote a project's pull requests go to: `origin` if its address parses, else the first one that does (BTN-205);
 * one on a forge with no adapter gives its host (EKR-8). GitLab is told by its host as the CI tells it (BTN-414).
 */
export function pullTarget(remotes: Remote[], gitlabUrls: readonly string[] = []): CiTarget | UnsupportedRemote | null {
  const parsed = remotes.flatMap(({ name, url }) => {
    const repo = parseRemote(url)
    return repo === null ? [] : [{ name, url, repo }]
  })
  const chosen = parsed.find(({ name }) => name === 'origin') ?? parsed[0]
  if (chosen === undefined) return null
  const { host, ...repo } = chosen.repo
  const kind = remoteKind(host, gitlabUrls)
  if (kind === null) return { kind, remote: chosen.name, host }
  if (kind !== 'gitlab') return { kind, remote: chosen.name, ...repo }
  const gitlab = gitlabRepo(chosen.url, host, gitlabUrls)
  return gitlab === null ? { kind: null, remote: chosen.name, host } : { kind, remote: chosen.name, ...gitlab }
}

export const unsupportedHost = (target: UnsupportedRemote): Notice => notice('review.unsupportedHost', { remote: target.remote, host: target.host })

/** No profile has a token for the remote: its kind and address are what the page's "Add profile" opens on (EKR-7). */
export const noToken = (target: CiTarget): Notice => notice('review.noToken', { remote: target.remote, kind: target.kind, web: target.web })

export type PullReadiness ={ target: CiTarget; token: string } | { notice: Notice }

/**
 * Whether a project's PR mode has where to go: the remote its pull requests go to and the token for its forge, or why
 * not (EKR-12). `token` — the one a profile has for the remote (`ciToken`), `null` without one.
 */
export function pullReadiness(project: string, remotes: Remote[], token: (target: CiTarget) => string | null, gitlabUrls: readonly string[] = []): PullReadiness {
  const target = pullTarget(remotes, gitlabUrls)
  if (target === null) return { notice: notice('review.noRemote', { project }) }
  if (target.kind === null) return { notice: unsupportedHost(target) }
  const found = token(target)
  return found === null ? { notice: noToken(target) } : { target, token: found }
}

/** The pull request's title and body from the session's note: the first line that is not blank, then the rest. */
export function describedBy(note: string): { title: string; body: string } | null {
  const lines = note.replace(/\r\n/g, '\n').split('\n')
  const first = lines.findIndex((line) => line.trim() !== '')
  if (first === -1) return null
  const title = lines[first]!.replace(/^#+\s*/, '').trim()
  return { title, body: lines.slice(first + 1).join('\n').trim() }
}

const CLOSING = '(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s*:?\\s+'
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The issue a pull request closes on its merge: `owner/repo#N` and the pull request's repository, both `owner/repo`. */
export interface Closes {
  issue: string
  repo: string
  /** The GitLab server of a merge request: its issues have `/-/issues/` addresses, its own project's is named `#N`. */
  gitlab?: string
}

const GITHUB_ISSUE = /^[^\s/#]+\/[^\s/#]+#\d+$/
const GITLAB_ISSUE = /^(.+)\/-\/issues\/(\d+)$/

/**
 * The issue the tracker's `closingRef` names, for a pull request on the target: GitHub's `owner/repo#N` on GitHub, a
 * GitLab issue's address on the merge request's own GitLab server (BTN-414). `null` — the forge cannot close it.
 */
export function closingOf(target: CiTarget, ref: string): Closes | null {
  const repo = `${target.owner}/${target.repo}`
  if (target.kind === 'github') return GITHUB_ISSUE.test(ref) ? { issue: ref, repo } : null
  // The tracker's address is the profile's as the user wrote it; the remote's host is lowercase.
  if (target.kind !== 'gitlab' || !ref.toLowerCase().startsWith(`${target.web.toLowerCase()}/`)) return null
  const address = GITLAB_ISSUE.exec(ref.slice(target.web.length + 1))
  return address === null ? null : { issue: `${address[1]!}#${address[2]!}`, repo, gitlab: target.web }
}

/**
 * The body ending with `Closes <issue>` (BTN-295), `owner/repo#N`, unless the session closes that issue there itself:
 * by the same name, by its address or, in the pull request's own repository `repo`, by `#N`. On GitLab (`gitlab` — its
 * server) an issue of the merge request's own project is closed as `#N`.
 */
export function closingBody(body: string, issue: string, repo: string, gitlab?: string): string {
  const hash = issue.lastIndexOf('#')
  const slug = issue.slice(0, hash)
  const number = issue.slice(hash + 1)
  const own = slug.toLowerCase() === repo.toLowerCase()
  const address = gitlab === undefined ? `https?://github\\.com/${escaped(slug)}/issues/` : `https?://${escaped(gitlab.replace(/^https?:\/\//, ''))}/${escaped(slug)}/-/issues/`
  const names = [escaped(slug) + '#', address]
  if (own) names.push('(?<![\\w/])#')
  if (new RegExp(`\\b${CLOSING}(?:${names.join('|')})${number}(?!\\d)`, 'i').test(body)) return body
  const line = `Closes ${gitlab !== undefined && own ? `#${number}` : issue}`
  return body === '' ? line : `${body}\n\n${line}`
}

/**
 * Pushes the branch the session's folder is on and opens its pull request, or finds the one already open: a session
 * that fixed what the review asked marks again, and its branch goes to the same pull request. `null` — the branch has
 * nothing beyond the base and its worktree is clean: the task changed nothing in the repository, nothing is pushed
 * (BTN-222). `closes` — the task's issue the forge closes on the merge (`closingOf`), for `closingBody`.
 */
export async function openPull(
  git: Git,
  workdir: string,
  note: string,
  remote: string,
  forge: Forge,
  base: string,
  now: () => Date,
  closes?: Closes,
): Promise<Opened | null> {
  const branch = (await git(workdir, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).out.trim()
  if (branch === '') throw fail('review.noBranch', { path: workdir })
  const notePath = isAbsolute(note) ? note : join(workdir, note)
  if ((await aheadOf(git, workdir, remote, base)) === 0) {
    if (await committed(git, workdir, notePath)) return null
    throw fail('review.nothingAhead', { branch, base })
  }
  const status = await git(workdir, ['status', '--porcelain', '--untracked-files=no'])
  if (status.code !== 0 || status.out.trim() !== '') throw fail('review.dirty', { path: workdir }, { detail: status.out })
  const described = describedBy(await readFile(notePath, 'utf8').catch(() => ''))
  if (described === null) throw fail('review.noNote', { path: notePath })

  const pushed = await git(workdir, ['push', '--set-upstream', remote, `${branch}:refs/heads/${branch}`])
  if (pushed.code !== 0) throw fail('review.pushFailed', { branch, remote }, { detail: pushed.out })
  const pushedAt = now().toISOString()
  const body = closes === undefined ? described.body : closingBody(described.body, closes.issue, closes.repo, closes.gitlab)
  const pull = (await forge.find(branch)) ?? (await forge.create({ branch, base, title: described.title, body }))
  return { ...pull, branch, pushedAt }
}

/**
 * The commits of the folder's branch beyond the remote's base, as fresh as a fetch gets it: the local main may lag in
 * PR mode, where merges happen on the forge. `null` — git could not count, the forge judges.
 */
async function aheadOf(git: Git, workdir: string, remote: string, base: string): Promise<number | null> {
  await git(workdir, ['fetch', '--quiet', remote, base])
  const counted = await git(workdir, ['rev-list', '--count', `refs/remotes/${remote}/${base}..HEAD`])
  const count = Number(counted.out.trim())
  return counted.code === 0 && counted.out.trim() !== '' && Number.isInteger(count) ? count : null
}

/** Whether the worktree holds no work left out of a commit, new files included; the pull request's note is not work. */
async function committed(git: Git, workdir: string, notePath: string): Promise<boolean> {
  const status = await git(workdir, ['status', '--porcelain', '--untracked-files=all'])
  if (status.code !== 0) return false
  const note = relative(workdir, notePath).replace(/\\/g, '/')
  return status.out.split(/\r?\n/).every((line) => line.trim() === '' || line === `?? ${note}`)
}
