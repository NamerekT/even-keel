import type { Notice } from '../../../src/notice/notice.js'
import type { EvenKeelState } from '../../../src/state.js'
import { noticeId } from '../layout/NoticeButtons.js'
import { projectLabel } from '../state.js'

type Facts = Pick<EvenKeelState, 'gitFound' | 'config' | 'noticesDismissed' | 'projectLabels'>

/** The mark of "Not now": one per project, its stamp the repository's birth, so one made anew asks again (BTN-1025). */
export const gitFoundMark = (project: string) => noticeId('git.found', project)

/** The notice that the folder of a project without git has become a repository, unless closed for this one; `null` — none. */
export function gitFoundNotice(state: Facts, project: string): { notice: Notice; stamp: string } | null {
  const found = state.gitFound?.[project]
  if (found === undefined) return null
  const stamp = String(found.since)
  if (state.noticesDismissed?.[gitFoundMark(project)] === stamp) return null
  return { notice: { code: 'git.found', params: { project: projectLabel(state, project), branch: found.branch } }, stamp }
}

/**
 * The repository's branch the "Turn on git" dialog offers as the project's main branch: the one its agent's `git init`
 * left, when it is not the project's (`master` against `main`); `null` — nothing to offer.
 */
export function offeredBranch(state: Pick<EvenKeelState, 'gitFound' | 'config'>, project: string): { current: string; main: string } | null {
  const current = state.gitFound?.[project]?.branch ?? null
  if (current === null) return null
  const main = state.config.projects[project]?.branch.trim() || 'main'
  return current === main ? null : { current, main }
}
