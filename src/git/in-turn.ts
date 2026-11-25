import { pathKey } from '../paths.js'
import type { Git } from './types.js'

/** The subcommands that update a clone's refs from a remote or to it; a `git sync` alias is one too. */
const REF_WRITERS: ReadonlySet<string> = new Set(['fetch', 'pull', 'push', 'sync'])

/**
 * Git whose fetches, pulls, pushes and syncs of one folder run one after another (BTN-1720): two at once in a clone
 * race for its remote-tracking refs, and the one that loses fails with `incorrect old value provided`. A landing and a
 * forward to another machine's commit meet like that in the main checkout. Other calls and other folders run at once;
 * a call of a worktree is its own folder's, so a session's own git there is not waited for.
 */
export function remoteCallsInTurn(git: Git): Git {
  const tails = new Map<string, Promise<unknown>>()
  return (cwd, args, env) => {
    if (!REF_WRITERS.has(args[0] ?? '')) return git(cwd, args, env)
    const key = pathKey(cwd)
    const run = (tails.get(key) ?? Promise.resolve()).catch(() => undefined).then(() => git(cwd, args, env))
    tails.set(key, run)
    void run.catch(() => undefined).then(() => {
      if (tails.get(key) === run) tails.delete(key)
    })
    return run
  }
}
