import { notice, type Notice } from '../notice/notice.js'
import type { Git } from './types.js'

// A `git sync` alias wins: the repository's own one always, the user's global one only for a branch named main,
// since such an alias is written for main. Without it the main branch is merged from every remote and pushed
// back to each, the same as the alias the project was built with.
export async function syncMain(git: Git, repo: string, remotes: string[], main = 'main'): Promise<Notice | null> {
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
