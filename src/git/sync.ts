import type { Git } from './types.js'

// A `git sync` alias, the repository's own or the user's global one, wins; without it main is merged
// from every remote and pushed back to each, the same as the alias the project was built with.
export async function syncMain(git: Git, repo: string, remotes: string[]): Promise<string | null> {
  if ((await git(repo, ['config', '--get', 'alias.sync'])).code === 0) {
    const synced = await git(repo, ['sync'])
    return synced.code === 0 ? null : synced.out || `git sync exited with ${synced.code}`
  }

  const branch = (await git(repo, ['branch', '--show-current'])).out.trim()
  if (branch !== 'main') return `sync: ${repo} is on ${branch || 'a detached HEAD'}, not main; switch it to main`

  for (const remote of remotes) {
    const fetched = await git(repo, ['fetch', remote])
    if (fetched.code !== 0) return `sync: could not fetch ${remote}: ${fetched.out}`
    if ((await git(repo, ['rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/main`])).code !== 0) continue
    const merged = await git(repo, ['merge', '--no-edit', `${remote}/main`])
    if (merged.code !== 0) {
      await git(repo, ['merge', '--abort'])
      return `sync: ${remote}/main does not merge cleanly into main, merge it by hand: ${merged.out}`
    }
  }

  for (const remote of remotes) {
    const pushed = await git(repo, ['push', remote, 'main'])
    if (pushed.code !== 0) return `sync: could not push main to ${remote}: ${pushed.out}`
  }
  return null
}
