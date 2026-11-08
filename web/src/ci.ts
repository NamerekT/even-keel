import { pushStatus, stuckSince, type CiView } from '../../src/ci/model.js'

export type CiLevel = 'error' | 'stuck' | 'failure' | 'off' | 'running' | 'success' | 'idle'

/** Most urgent first: the badge of several CIs shows the first level any of them has. */
const ORDER: CiLevel[] = ['error', 'stuck', 'failure', 'off', 'running', 'success', 'idle']

export function ciLevel(view: CiView, now: Date): CiLevel {
  if (view.health !== 'ok') return view.health
  if (stuckSince(view, now) !== null) return 'stuck'
  const status = view.current === null ? null : pushStatus(view.current.runs.map((each) => each.run))
  // A new push takes over from the last one's end; within a push a red run decides at once, as in the verdict.
  if (view.pushed !== null) return 'running'
  if (status === 'failure') return 'failure'
  if (status === 'running' || status === 'queued') return 'running'
  // A run no runner took checked nothing: the runs are not taken, as the verdict says (BTN-761).
  if (status === 'notTaken') return 'stuck'
  if (status === 'success') return 'success'
  return 'idle'
}

/** The CIs that speak for the badge: those the project counts, or every one when it counts none (BTN-828). */
export function countedViews(views: CiView[]): CiView[] {
  const counted = views.filter((view) => view.counted)
  return counted.length > 0 ? counted : views
}

export function worstCiLevel(views: CiView[], now: Date): CiLevel {
  const levels = new Set(countedViews(views).map((view) => ciLevel(view, now)))
  return ORDER.find((level) => levels.has(level)) ?? 'idle'
}
