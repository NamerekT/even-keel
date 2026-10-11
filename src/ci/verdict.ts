import { notice, type Notice } from '../notice/notice.js'
import { STUCK_MS, type CiKind, type CiRun, type CiView } from './model.js'

export const CI_TITLES: Readonly<Record<CiKind, string>> = { forgejo: 'Forgejo', github: 'GitHub Actions' }

export interface RedRun {
  kind: CiKind
  run: CiRun
}

/** What the CIs of a project say about a commit pushed to its main. */
export type CiVerdict =
  /** No CI is counted for the project. */
  | { state: 'none' }
  | { state: 'pending' }
  | { state: 'green' }
  | { state: 'red'; failed: RedRun[] }
  /** A CI does not answer or does not take the commit; the chain does not wait for it. */
  | { state: 'unavailable'; reasons: Notice[] }

export const shortCommit = (commit: string): string => commit.slice(0, 7)

/**
 * A red run decides at once; then a CI still at work keeps the chain waiting; then one that cannot say
 * makes the commit unchecked. `since` is when the commit was pushed.
 */
export function verdictOf(views: CiView[], commit: string, since: string, now: Date): CiVerdict {
  if (views.length === 0) return { state: 'none' }
  const each = views.map((view) => viewVerdict(view, commit, since, now))
  const failed = each.flatMap((verdict) => (verdict.state === 'red' ? verdict.failed : []))
  if (failed.length > 0) return { state: 'red', failed }
  if (each.some((verdict) => verdict.state === 'pending')) return { state: 'pending' }
  const reasons = each.flatMap((verdict) => (verdict.state === 'unavailable' ? verdict.reasons : []))
  if (reasons.length > 0) return { state: 'unavailable', reasons }
  return { state: 'green' }
}

function viewVerdict(view: CiView, commit: string, since: string, now: Date): CiVerdict {
  const ci = CI_TITLES[view.kind]
  if (view.health !== 'ok') return { state: 'unavailable', reasons: [view.error ?? notice('ci.unreachable', { ci })] }
  const known = [...(view.current === null ? [] : [view.current.run]), ...view.history]
  const runs = known.filter((run, index) => run.commit === commit && known.findIndex((other) => other.id === run.id) === index)
  const failed = runs.filter((run) => run.status === 'failure')
  if (failed.length > 0) return { state: 'red', failed: failed.map((run) => ({ kind: view.kind, run })) }
  const late = now.getTime() - Date.parse(since) >= STUCK_MS
  const notTaken: CiVerdict = { state: 'unavailable', reasons: [notice('ci.notTaken', { ci, commit: shortCommit(commit) })] }
  if (runs.length === 0) return late ? notTaken : { state: 'pending' }
  if (runs.some((run) => run.status === 'running')) return { state: 'pending' }
  const queued = runs.filter((run) => run.status === 'queued')
  if (queued.length === 0) return { state: 'green' }
  const runnerBusy = known.some((run) => run.status === 'running')
  const stuck = queued.every((run) => now.getTime() - Date.parse(run.createdAt) >= STUCK_MS)
  return stuck && !runnerBusy ? notTaken : { state: 'pending' }
}
