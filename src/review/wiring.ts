import { ciSource } from '../ci/adapters.js'
import type { CiTarget } from '../ci/remote.js'
import type { ReviewDeps } from '../chain/model.js'
import type { Git } from '../git/types.js'
import { fail, NoticeError, noticeOf } from '../notice/notice.js'
import { remotesIn } from '../projects/remotes.js'
import { forgejoPulls } from './forgejo.js'
import { githubPulls } from './github.js'
import type { Forge } from './model.js'
import { noToken, openPull, pullReadiness, pullTarget, unsupportedHost } from './open.js'
import type { PullRefusals } from './refusals.js'

const RUNS_POLLED = 20

export interface ReviewWiring {
  gitlabUrls?: () => readonly string[]
  git: Git
  repo: (project: string) => string
  main: (project: string) => string
  on: (project: string) => boolean
  /** The token for the remote's forge (`ciToken`); `null` — no profile has one. */
  token: (project: string, target: CiTarget) => string | null
  complete: (project: string, task: string) => Promise<void>
  /** The task's GitHub issue, `owner/repo#N` (`TaskSource.closingRef`); `null` — the task is not in GitHub issues. */
  closingRef?: (project: string, task: string) => Promise<string | null>
  /** Where a token the forge refused to open a pull request with is told, for the profile's card (EKR-9). */
  refusals?: PullRefusals
  now: () => Date
  timeoutMs: number
}

/** PR mode's reach into git, the forges and the tracker, for the dispatcher (BTN-205). */
export function reviewDeps(wiring: ReviewWiring): ReviewDeps {
  const { git, timeoutMs } = wiring

  /** The remote named, while git still has it on a forge. */
  async function targetOf(project: string, remote: string): Promise<CiTarget> {
    const remotes = await remotesIn(git, wiring.repo(project))
    const target = pullTarget(remotes.filter(({ name }) => name === remote), wiring.gitlabUrls?.())
    if (target === null) throw fail('review.noRemote', { project })
    if (target.kind === null) throw new NoticeError(unsupportedHost(target))
    return target
  }

  function tokenOf(project: string, target: CiTarget): string {
    const token = wiring.token(project, target)
    if (token === null) throw new NoticeError(noToken(target))
    return token
  }

  function forgeOf(target: CiTarget, token: string): Forge {
    const { owner, repo, web } = target
    return target.kind === 'github' ? githubPulls({ owner, repo, token }, timeoutMs) : forgejoPulls({ web, owner, repo, token }, timeoutMs)
  }

  return {
    on: wiring.on,
    open: async (project, task, session) => {
      const ready = pullReadiness(project, await remotesIn(git, wiring.repo(project)), (target) => wiring.token(project, target), wiring.gitlabUrls?.())
      if ('notice' in ready) throw new NoticeError(ready.notice)
      const { target } = ready
      const forge = forgeOf(target, ready.token)
      const issue = target.kind === 'github' ? await wiring.closingRef?.(project, task) : null
      const closes = issue == null ? undefined : { issue, repo: `${target.owner}/${target.repo}` }
      let opened: Awaited<ReturnType<typeof openPull>>
      try {
        opened = await openPull(git, session.workdir, session.pullRequest ?? '', target.remote, forge, wiring.main(project), wiring.now, closes)
      } catch (error) {
        if (noticeOf(error).code === 'review.denied') wiring.refusals?.note(project, target, ready.token)
        throw error
      }
      wiring.refusals?.clear(project)
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
