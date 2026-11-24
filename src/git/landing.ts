import { notice, type Notice } from '../notice/notice.js'
import { firstCommits, inAll, mergedCommits, remoteMain, remotesOf } from './merged.js'
import { diverged, readOnly, REJECTED, syncAlias, transientFailure, type MergeCheck, type TransientFailure } from './sync.js'
import type { Git } from './types.js'

/** The red command of a landing's check, with its output. */
export interface LandRed {
  command: string
  code: number
  output: string
}

/**
 * How a landing of a task's merge into the main of its remotes went (BTN-1581):
 * - `none` — nothing of the task waits to land: not merged into the local main, landed already, or no remote;
 * - `landed` — main is pushed to every remote, at `commit` (unset — not read): the hub brings the other machines' main
 *   up to it (BTN-1583);
 * - `returned` — main of `remote` does not merge cleanly (`files`) or the check of the merge is red (`red`): the local
 *   main is rolled back to before the session's merge, for the session to resolve;
 * - `failed` — for a while (`transient`: a remote out of reach, its server failing) or a refusal only a person can
 *   deal with; main is left as it is.
 */
export type LandOutcome =
  | { state: 'none' }
  | { state: 'landed'; commit?: string }
  | { state: 'returned'; remote: string; files: string[] }
  | { state: 'returned'; remote: string; red: LandRed }
  | { state: 'failed'; transient: TransientFailure | null; failure: Notice }

export interface LandRequest {
  task: string
  main: string
  /** A carry's release commit, which stands for the task's branches. */
  commit?: string
  /** The project's `commands.check`, run on main merged with commits that came from the remote. */
  check?: MergeCheck
}

const NONE: LandOutcome = { state: 'none' }

/** How far back main's first-parent line is walked for the commit before the session's merge. */
const BASE_DEPTH = 200

/**
 * Lands what the session merged into the checkout's main: main is pushed once it holds the main of each remote, merged
 * in first when a remote went ahead — checked then, if the request has a check. A push the remote rejected because
 * another clone pushed meanwhile gets the whole landing again, twice at most, as `syncMain` does. A `git sync` alias,
 * read as `syncMain` reads it, does the fetch, merge and push itself; its conflict is told by the files it leaves.
 */
export async function landTask(git: Git, repo: string, request: LandRequest): Promise<LandOutcome> {
  const { main } = request
  const remotes = await remotesOf(git, repo)
  if (remotes.length === 0) return NONE
  const own = await ownCommits(git, repo, request)
  if (own.length === 0) return NONE
  const tracked = remotes.map((remote) => remoteMain(remote, main))
  if (await everyIn(git, repo, own, tracked)) return NONE

  const branch = (await git(repo, ['branch', '--show-current'])).out.trim()
  if (branch !== main) return failed(notice('sync.notMain', { repo, branch, main }))
  const firsts = request.commit === undefined ? await firstCommits(git, repo, request.task, tracked) : []
  const base = await baseOf(git, repo, [...own, ...firsts], main)
  if (base === null) return failed(notice('landing.noBase', { main }))

  const alias = await syncAlias(git, repo, main)
  let outcome = await landOnce(git, repo, remotes, request, base, alias)
  for (let repeat = 2; repeat > 0 && outcome.state === 'failed' && REJECTED.test(outcome.failure.detail ?? ''); repeat--) {
    outcome = await landOnce(git, repo, remotes, request, base, alias)
  }
  return outcome
}

async function ownCommits(git: Git, repo: string, { task, main, commit }: LandRequest): Promise<string[]> {
  if (commit === undefined) return mergedCommits(git, repo, task, main)
  return (await inAll(git, repo, commit, [`refs/heads/${main}`])) ? [commit] : []
}

async function everyIn(git: Git, repo: string, commits: string[], refs: string[]): Promise<boolean> {
  for (const commit of commits) if (!(await inAll(git, repo, commit, refs))) return false
  return true
}

/** The newest commit of main's first-parent line that has none of `own`: main before the session's first unlanded merge. */
async function baseOf(git: Git, repo: string, own: string[], main: string): Promise<string | null> {
  const line = await git(repo, ['rev-list', '--first-parent', `--max-count=${BASE_DEPTH}`, `refs/heads/${main}`])
  if (line.code !== 0) return null
  for (const commit of line.out.split(/\r?\n/).filter(Boolean)) {
    let clear = true
    for (const each of own) if ((await git(repo, ['merge-base', '--is-ancestor', each, commit])).code === 0) clear = false
    if (clear) return commit
  }
  return null
}

const failed = (failure: Notice): LandOutcome => ({ state: 'failed', transient: transientFailure(failure), failure })

async function landOnce(git: Git, repo: string, remotes: string[], request: LandRequest, base: string, alias: boolean): Promise<LandOutcome> {
  return alias ? landByAlias(git, repo, remotes, request.main, base) : landOwn(git, repo, remotes, request, base)
}

async function landByAlias(git: Git, repo: string, remotes: string[], main: string, base: string): Promise<LandOutcome> {
  const synced = await git(repo, ['sync'])
  if (synced.code === 0) return landed(git, repo, main)
  const files = await unmerged(git, repo)
  if (files.length > 0 || /^CONFLICT/m.test(synced.out)) {
    await git(repo, ['merge', '--abort'])
    return returned(git, repo, base, main, { state: 'returned', remote: remotes[0]!, files })
  }
  return failed(readOnly(synced) ?? notice('sync.alias', { exit: synced.code }, { detail: synced.out }))
}

async function landOwn(git: Git, repo: string, remotes: string[], { main, check }: LandRequest, base: string): Promise<LandOutcome> {
  let mixed: string | null = null
  for (const remote of remotes) {
    const fetched = await git(repo, ['fetch', remote])
    if (fetched.code !== 0) return failed(notice('sync.fetch', { remote }, { detail: fetched.out }))
    const theirs = remoteMain(remote, main)
    if ((await git(repo, ['rev-parse', '--verify', '--quiet', theirs])).code !== 0) continue
    if (mixed === null && (await diverged(git, repo, theirs))) mixed = remote
    const merged = await git(repo, ['merge', '--no-edit', `${remote}/${main}`])
    if (merged.code === 0) continue
    const files = await unmerged(git, repo)
    await git(repo, ['merge', '--abort'])
    if (files.length === 0) return failed(notice('sync.merge', { remote, main }, { detail: merged.out }))
    return returned(git, repo, base, main, { state: 'returned', remote, files })
  }

  if (check !== undefined && mixed !== null) {
    const red = await check.run()
    if (red !== null) return returned(git, repo, base, main, { state: 'returned', remote: mixed, red })
  }

  for (const remote of remotes) {
    const pushed = await git(repo, ['push', remote, main])
    if (pushed.code !== 0) return failed(readOnly(pushed) ?? notice('sync.push', { remote, main }, { detail: pushed.out }))
  }
  return landed(git, repo, main)
}

async function landed(git: Git, repo: string, main: string): Promise<LandOutcome> {
  const head = await git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${main}`])
  return head.code === 0 && head.out.trim() !== '' ? { state: 'landed', commit: head.out.trim() } : { state: 'landed' }
}

async function unmerged(git: Git, repo: string): Promise<string[]> {
  const listed = await git(repo, ['diff', '--name-only', '--diff-filter=U'])
  return listed.code === 0 ? listed.out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : []
}

/** Main goes back to before the session's merge, keeping the checkout clean: the session merges again once it resolved. */
async function returned(git: Git, repo: string, base: string, main: string, outcome: LandOutcome): Promise<LandOutcome> {
  const reset = await git(repo, ['reset', '--keep', base])
  if (reset.code !== 0) return failed(notice('landing.notReset', { main, commit: base.slice(0, 7) }, { detail: reset.out }))
  return outcome
}
