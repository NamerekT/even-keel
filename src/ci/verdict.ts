import { notice, type Notice } from '../notice/notice.js'
import { STUCK_MS, type BusyRunner, type CiKind, type CiRun, type CiView } from './model.js'

export const CI_TITLES: Readonly<Record<CiKind, string>> = { forgejo: 'Forgejo', github: 'GitHub Actions', gitlab: 'GitLab CI' }

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
 * makes the commit unchecked. `since` is when the commit was pushed. `neighbours` are CIs of other repositories:
 * a run of theirs at work on the same host means its runner is busy (a self-hosted forge's runner is shared, BTN-719).
 */
export function verdictOf(views: CiView[], commit: string, since: string, now: Date, neighbours: CiView[] = []): CiVerdict {
  if (views.length === 0) return { state: 'none' }
  const each = views.map((view) => viewVerdict(view, commit, since, now, neighbours))
  const failed = each.flatMap((verdict) => (verdict.state === 'red' ? verdict.failed : []))
  if (failed.length > 0) return { state: 'red', failed }
  if (each.some((verdict) => verdict.state === 'pending')) return { state: 'pending' }
  const reasons = each.flatMap((verdict) => (verdict.state === 'unavailable' ? verdict.reasons : []))
  if (reasons.length > 0) return { state: 'unavailable', reasons }
  return { state: 'green' }
}

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

const runningOf = (view: CiView): CiRun | undefined =>
  [...(view.current?.runs.map((each) => each.run) ?? []), ...view.history].find((run) => run.status === 'running')

/**
 * The run a queued run of `view` waits behind: one of its own at work, or one of a neighbour of the same kind on the
 * same host (a self-hosted forge's runner is shared, BTN-719). `null` — the runner is free.
 */
export function busyRunner(view: CiView, neighbours: CiView[]): BusyRunner | null {
  const host = hostOf(view.url)
  const holders = [view, ...(host === null ? [] : neighbours.filter((other) => other !== view && other.kind === view.kind && other.health === 'ok' && hostOf(other.url) === host))]
  for (const holder of holders) {
    const run = runningOf(holder)
    if (run !== undefined) return { repository: holder.repository, number: run.number, url: run.url }
  }
  return null
}

function viewVerdict(view: CiView, commit: string, since: string, now: Date, neighbours: CiView[]): CiVerdict {
  const ci = CI_TITLES[view.kind]
  if (view.health !== 'ok') return { state: 'unavailable', reasons: [view.error ?? notice('ci.unreachable', { ci })] }
  // Not asked since the service started: an empty history says nothing about the commit yet.
  if (view.checkedAt === null) return { state: 'pending' }
  const known = [...(view.current?.runs.map((each) => each.run) ?? []), ...view.history]
  const runs = known.filter((run, index) => run.commit === commit && known.findIndex((other) => other.id === run.id) === index)
  const failed = runs.filter((run) => run.status === 'failure' && run.notTaken !== true)
  if (failed.length > 0) return { state: 'red', failed: failed.map((run) => ({ kind: view.kind, run })) }
  const late = now.getTime() - Date.parse(since) >= STUCK_MS
  const notTaken: CiVerdict = { state: 'unavailable', reasons: [notice('ci.notTaken', { ci, commit: shortCommit(commit) })] }
  if (runs.length === 0) return late ? notTaken : { state: 'pending' }
  if (runs.some((run) => run.status === 'running')) return { state: 'pending' }
  const queued = runs.filter((run) => run.status === 'queued')
  // A run failed only for want of a runner (BTN-761) checked nothing: never green, though the CI took it.
  if (queued.length === 0) return runs.some((run) => run.notTaken === true) ? notTaken : { state: 'green' }
  const runnerBusy = busyRunner(view, neighbours) !== null
  const stuck = queued.every((run) => now.getTime() - Date.parse(run.createdAt) >= STUCK_MS)
  return stuck && !runnerBusy ? notTaken : { state: 'pending' }
}
