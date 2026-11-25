import { notice, type Notice } from '../notice/notice.js'
import type { Git, GitResult } from './types.js'

/**
 * A push refused because the remote got commits after the fetch: another clone of it pushed meanwhile. Git sees it
 * as `[rejected]` before sending, or as the remote's refusal to update the ref when the other push landed after this
 * one read the remote's refs (BTN-686). Other `[remote rejected]` reasons, a declined server hook among them, stay.
 */
export const REJECTED = /\[rejected\]|\[remote rejected\][^\n]*\((?:incorrect old value|failed to update ref|cannot lock ref|failed to lock|stale info)/

/** What git (curl or ssh under it) says when it never reached the remote; a refusal of the remote is not among it. */
const UNREACHABLE =
  /Failed to connect|Could not resolve host|Could not resolve hostname|Temporary failure in name resolution|Operation timed out|Connection timed out|Connection reset|Connection refused|Network is unreachable|No route to host/i

/**
 * What git says when the remote's server failed with a 5xx (BTN-1654): its message in `[remote rejected]` or a
 * `remote:` line, or curl's status of the HTTP answer.
 */
const SERVER_ERROR =
  /\[remote rejected\][^\n]*\((?:Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout)\)|^remote:.*(?:Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout)|The requested URL returned error: 5\d\d|HTTP 5\d\d/m

/** A server hook declined the push: whatever the hook printed, that is the remote's decision. */
const HOOK_DECLINED = /\[remote rejected\][^\n]*hook declined/

/**
 * Git of this clone could not update a local ref, its remote-tracking one mostly, because another process of the same
 * clone was updating it at that moment (BTN-1720): git's own `error:` line, never the remote's `[remote rejected]`.
 */
const REF_RACE = /^error: (?:fetching ref \S+ failed|cannot lock ref|failed to lock|update_ref failed|Unable to create '[^'\n]*\.lock')/m

/** Why a sync failed for a while only: a remote out of reach, its server answered with an error, a parallel ref update. */
export type TransientFailure = 'network' | 'server' | 'race'

/** Whether a sync failed so that a later try may go through (BTN-267, BTN-1654); `null` — a failure a person deals with. */
export function transientFailure(failure: Notice): TransientFailure | null {
  if (!(failure.code === 'sync.fetch' || failure.code === 'sync.push' || failure.code === 'sync.alias')) return null
  const detail = failure.detail ?? ''
  if (UNREACHABLE.test(detail)) return 'network'
  if (REF_RACE.test(detail)) return 'race'
  return SERVER_ERROR.test(detail) && !HOOK_DECLINED.test(detail) ? 'server' : null
}

/**
 * The project's check run on main merged with commits another machine pushed, before the push (BTN-995); `null` — green.
 * Only a project several machines work on at once has one.
 */
export interface MergeCheck {
  run: () => Promise<{ command: string; code: number; output: string } | null>
}

// A `git sync` alias wins: the repository's own one always, the user's global one only for a branch named main,
// since such an alias is written for main. Without it the main branch is merged from every remote and pushed
// back to each, the same as the alias the project was built with. A push rejected because another clone of the
// remote pushed between the fetch and the push (BTN-210) gets the whole sync once more; with a merge check, twice.
export async function syncMain(git: Git, repo: string, remotes: string[], main = 'main', check?: MergeCheck): Promise<Notice | null> {
  let result = await syncOnce(git, repo, remotes, main, check)
  for (let repeat = check === undefined ? 1 : 2; repeat > 0; repeat--) {
    if (result === null || !(result.code === 'sync.push' || result.code === 'sync.alias') || !REJECTED.test(result.detail ?? '')) return result
    result = await syncOnce(git, repo, remotes, main, check)
  }
  return result
}

/** Whether the checkout's sync goes through a `git sync` alias, as `syncMain` reads it. */
export async function syncAlias(git: Git, repo: string, main: string): Promise<boolean> {
  const alias = main === 'main' ? ['config', '--get', 'alias.sync'] : ['config', '--local', '--get', 'alias.sync']
  return (await git(repo, alias)).code === 0
}

async function syncOnce(git: Git, repo: string, remotes: string[], main: string, check?: MergeCheck): Promise<Notice | null> {
  if (await syncAlias(git, repo, main)) {
    const synced = await git(repo, ['sync'])
    return synced.code === 0 ? null : (readOnly(synced) ?? notice('sync.alias', { exit: synced.code }, { detail: synced.out }))
  }

  const branch = (await git(repo, ['branch', '--show-current'])).out.trim()
  if (branch !== main) return notice('sync.notMain', { repo, branch, main })

  const before = check === undefined ? '' : (await git(repo, ['rev-parse', 'HEAD'])).out.trim()
  let mixed = false
  for (const remote of remotes) {
    const fetched = await git(repo, ['fetch', remote])
    if (fetched.code !== 0) return notice('sync.fetch', { remote }, { detail: fetched.out })
    const theirs = `refs/remotes/${remote}/${main}`
    if ((await git(repo, ['rev-parse', '--verify', '--quiet', theirs])).code !== 0) continue
    if (check !== undefined && !mixed) mixed = await diverged(git, repo, theirs)
    const merged = await git(repo, ['merge', '--no-edit', `${remote}/${main}`])
    if (merged.code !== 0) {
      await git(repo, ['merge', '--abort'])
      return notice('sync.merge', { remote, main }, { detail: merged.out })
    }
  }

  if (check !== undefined && mixed) {
    const red = await check.run()
    if (red !== null) {
      await git(repo, ['reset', '--keep', before])
      return notice('sync.checkRed', { main, command: red.command, code: red.code }, { detail: red.output })
    }
  }

  for (const remote of remotes) {
    const pushed = await git(repo, ['push', remote, main])
    if (pushed.code !== 0) return readOnly(pushed) ?? notice('sync.push', { remote, main }, { detail: pushed.out })
  }
  return null
}

/** A push the remote refused for writing with a profile's token (BTN-1541): the profile is named, with git's words. */
export function readOnly(pushed: GitResult): Notice | null {
  return pushed.denied === undefined ? null : notice('git.readOnly', { profile: pushed.denied.name, url: pushed.denied.url }, { detail: pushed.out })
}

/** Main and the remote's main each have commits the other lacks: merging them makes a commit nobody checked. */
export async function diverged(git: Git, repo: string, theirs: string): Promise<boolean> {
  if ((await git(repo, ['merge-base', '--is-ancestor', 'HEAD', theirs])).code === 0) return false
  return (await git(repo, ['merge-base', '--is-ancestor', theirs, 'HEAD'])).code !== 0
}

/**
 * Brings the main checkout's main up to the main of its remotes before a task branches off it, by fast-forward only:
 * another clone of the same remote (another project, BTN-210) may have pushed since this one last synced. A checkout
 * off main or with changes to tracked files is left alone, and so is a main that is ahead or diverged — the sync
 * after the task's Done deals with those.
 */
export async function fastForwardMain(git: Git, repo: string, main = 'main'): Promise<void> {
  if (!(await cleanOnMain(git, repo, main))) return
  const remotes = (await git(repo, ['remote'])).out.split(/\s+/).filter(Boolean)
  for (const remote of remotes) {
    if ((await git(repo, ['fetch', remote])).code !== 0) continue
    if ((await git(repo, ['rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/${main}`])).code !== 0) continue
    await git(repo, ['merge', '--ff-only', `${remote}/${main}`])
  }
}

/** How `fastForwardTo` left main: brought up to the commit (or holding it already), or left as it was and why. */
export type ForwardOutcome = 'forwarded' | 'offMain' | 'dirty' | 'merging' | 'notFastForward'

/**
 * Brings a machine's main up to a commit by fast-forward only: a green one before its commands after a green main
 * (BTN-994), not past it, so they run on the commit that was green; the one another machine pushed (BTN-1583). A
 * checkout off main, with changes to tracked files, in the middle of a merge, ahead or diverged is left as it is.
 */
export async function fastForwardTo(git: Git, repo: string, main: string, commit: string): Promise<ForwardOutcome> {
  if ((await git(repo, ['branch', '--show-current'])).out.trim() !== main) return 'offMain'
  const status = await git(repo, ['status', '--porcelain', '--untracked-files=no'])
  if (status.code !== 0 || status.out.trim() !== '') return 'dirty'
  if ((await git(repo, ['rev-parse', '--quiet', '--verify', 'MERGE_HEAD'])).code === 0) return 'merging'
  const remotes = (await git(repo, ['remote'])).out.split(/\s+/).filter(Boolean)
  for (const remote of remotes) await git(repo, ['fetch', remote])
  return (await git(repo, ['merge', '--ff-only', commit])).code === 0 ? 'forwarded' : 'notFastForward'
}

async function cleanOnMain(git: Git, repo: string, main: string): Promise<boolean> {
  if ((await git(repo, ['branch', '--show-current'])).out.trim() !== main) return false
  const status = await git(repo, ['status', '--porcelain', '--untracked-files=no'])
  return status.code === 0 && status.out.trim() === ''
}
