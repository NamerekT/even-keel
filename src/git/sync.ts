import { notice, type Notice } from '../notice/notice.js'
import type { Git } from './types.js'

/** A push refused because the remote got commits after the fetch: another clone of it pushed meanwhile. */
const REJECTED = /\[rejected\]/

// A `git sync` alias wins: the repository's own one always, the user's global one only for a branch named main,
// since such an alias is written for main. Without it the main branch is merged from every remote and pushed
// back to each, the same as the alias the project was built with. A push rejected because another clone of the
// remote pushed between the fetch and the push (BTN-210) gets the whole sync once more.
export async function syncMain(git: Git, repo: string, remotes: string[], main = 'main'): Promise<Notice | null> {
  const first = await syncOnce(git, repo, remotes, main)
  if (first === null || !(first.code === 'sync.push' || first.code === 'sync.alias') || !REJECTED.test(first.detail ?? '')) return first
  return syncOnce(git, repo, remotes, main)
}

async function syncOnce(git: Git, repo: string, remotes: string[], main: string): Promise<Notice | null> {
  const alias = main === 'main' ? ['config', '--get', 'alias.sync'] : ['config', '--local', '--get', 'alias.sync']
  if ((await git(repo, alias)).code === 0) {
    const synced = await git(repo, ['sync'])
    return synced.code === 0 ? null : notice('sync.alias', { exit: synced.code }, { detail: synced.out })
  }

  const branch = (await git(repo, ['branch', '--show-current'])).out.trim()
  if (branch !== main) return notice('sync.notMain', { repo, branch, main })

  for (const remote of remotes) {
    const fetched = await git(repo, ['fetch', remote])
    if (fetched.code !== 0) return notice('sync.fetch', { remote }, { detail: fetched.out })
    if ((await git(repo, ['rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/${main}`])).code !== 0) continue
    const merged = await git(repo, ['merge', '--no-edit', `${remote}/${main}`])
    if (merged.code !== 0) {
      await git(repo, ['merge', '--abort'])
      return notice('sync.merge', { remote, main }, { detail: merged.out })
    }
  }

  for (const remote of remotes) {
    const pushed = await git(repo, ['push', remote, main])
    if (pushed.code !== 0) return notice('sync.push', { remote, main }, { detail: pushed.out })
  }
  return null
}

/**
 * Brings the main checkout's main up to the main of its remotes before a task branches off it, by fast-forward only:
 * another clone of the same remote (another project, BTN-210) may have pushed since this one last synced. A checkout
 * off main or with changes to tracked files is left alone, and so is a main that is ahead or diverged — the sync
 * after the task's Done deals with those.
 */
export async function fastForwardMain(git: Git, repo: string, main = 'main'): Promise<void> {
  if ((await git(repo, ['branch', '--show-current'])).out.trim() !== main) return
  const status = await git(repo, ['status', '--porcelain', '--untracked-files=no'])
  if (status.code !== 0 || status.out.trim() !== '') return
  const remotes = (await git(repo, ['remote'])).out.split(/\s+/).filter(Boolean)
  for (const remote of remotes) {
    if ((await git(repo, ['fetch', remote])).code !== 0) continue
    if ((await git(repo, ['rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/${main}`])).code !== 0) continue
    await git(repo, ['merge', '--ff-only', `${remote}/${main}`])
  }
}
