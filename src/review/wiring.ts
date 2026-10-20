import { ciSource } from '../ci/adapters.js'
import type { CiTarget } from '../ci/remote.js'
import type { ReviewDeps } from '../chain/model.js'
import type { Git } from '../git/types.js'
import { fail, NoticeError } from '../notice/notice.js'
import { remotesIn } from '../projects/remotes.js'
import { forgejoPulls } from './forgejo.js'
import { githubPulls } from './github.js'
import type { Forge } from './model.js'
import { openPull, pullReadiness, pullTarget } from './open.js'

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

  /** The remote named, while git still has it on a forge. */
  async function targetOf(project: string, remote: string): Promise<CiTarget> {
    const remotes = await remotesIn(git, wiring.repo(project))
    const target = pullTarget(remotes.filter(({ name }) => name === remote))
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
      const ready = pullReadiness(project, await remotesIn(git, wiring.repo(project)), (target) => wiring.token(project, target))
      if ('notice' in ready) throw new NoticeError(ready.notice)
      const { target } = ready
      const forge = forgeOf(target, ready.token)
      const opened = await openPull(git, session.workdir, session.pullRequest ?? '', target.remote, forge, wiring.main(project), wiring.now)
      return opened === null ? null : { ...opened, remote: target.remote }
    },
    check: async (project, pull) => {
      const target = await targetOf(project, pull.remote)
      const token = tokenOf(project, target)
      const forge = forgeOf(target, token)
      const state = await forge.state(pull.number)
      if (state.state === 'merged') return { state, remarks: [], failed: [] }
      // A pull request closed unmerged: the task's next session gets every remark made on it (BTN-223).
      if (state.state === 'closed') return { state, remarks: await forge.remarks(pull.number, pull.at, () => true), failed: [] }
      const pushed = Date.parse(pull.pushedAt)
      const remarks = await forge.remarks(pull.number, pull.pushedAt, (key, at) => Date.parse(at) > pushed && !pull.seen.includes(key))
      // A CI that does not answer leaves the poll to the remarks and the conflict.
      const runs = await (ciSource(target, token, timeoutMs)?.runs(RUNS_POLLED) ?? Promise.resolve([])).catch(() => [])
      return { state, remarks, failed: runs.filter((run) => run.commit === state.head && run.status === 'failure') }
    },
    complete: wiring.complete,
  }
}
