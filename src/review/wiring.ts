import { ciSource } from '../ci/adapters.js'
import { remotesOf, type CiTarget } from '../ci/remote.js'
import type { ReviewDeps } from '../chain/model.js'
import type { Git } from '../git/types.js'
import { fail } from '../notice/notice.js'
import { forgejoPulls } from './forgejo.js'
import { githubPulls } from './github.js'
import type { Forge } from './model.js'
import { openPull, pullTarget } from './open.js'

const RUNS_POLLED = 20

export interface ReviewWiring {
  git: Git
  repo: (project: string) => string
  main: (project: string) => string
  on: (project: string) => boolean
  /** The token for the remote's forge (`ciToken`); `null` — no profile has one. */
  token: (project: string, target: CiTarget) => string | null
  complete: (project: string, task: string) => Promise<void>
  now: () => Date
  timeoutMs: number
}

/** PR mode's reach into git, the forges and the tracker, for the dispatcher (BTN-205). */
export function reviewDeps(wiring: ReviewWiring): ReviewDeps {
  const { git, timeoutMs } = wiring

  /** The remote pull requests go to (`pullTarget`), or the one named. */
  async function targetOf(project: string, remote?: string): Promise<CiTarget> {
    const urls = await git(wiring.repo(project), ['config', '--get-regexp', '^remote\\..*\\.url$'])
    const remotes = urls.code === 0 ? remotesOf(urls.out) : []
    const target = pullTarget(remote === undefined ? remotes : remotes.filter(({ name }) => name === remote))
    if (target === null) throw fail('review.noRemote', { project })
    return target
  }

  function tokenOf(project: string, target: CiTarget): string {
    const token = wiring.token(project, target)
    if (token === null) throw fail('review.noToken', { remote: target.remote })
    return token
  }

  function forgeOf(target: CiTarget, token: string): Forge {
    const { owner, repo, web } = target
    return target.kind === 'github' ? githubPulls({ owner, repo, token }, timeoutMs) : forgejoPulls({ web, owner, repo, token }, timeoutMs)
  }

  return {
    on: wiring.on,
    open: async (project, _task, session) => {
      const target = await targetOf(project)
      const forge = forgeOf(target, tokenOf(project, target))
      const opened = await openPull(git, session.workdir, session.pullRequest ?? '', target.remote, forge, wiring.main(project), wiring.now)
      return opened === null ? null : { ...opened, remote: target.remote }
    },
    check: async (project, pull) => {
      const target = await targetOf(project, pull.remote)
      const token = tokenOf(project, target)
      const forge = forgeOf(target, token)
      const pushed = Date.parse(pull.pushedAt)
      const [state, changes] = await Promise.all([
        forge.state(pull.number),
        forge.changes(pull.number, (id, at) => Date.parse(at) > pushed && !pull.seen.includes(`review:${id}`)),
      ])
      // A CI that does not answer leaves the poll to the reviews and the conflict.
      const runs = await (ciSource(target, token, timeoutMs)?.runs(RUNS_POLLED) ?? Promise.resolve([])).catch(() => [])
      return { state, changes, failed: runs.filter((run) => run.commit === state.head && run.status === 'failure') }
    },
    complete: wiring.complete,
  }
}
