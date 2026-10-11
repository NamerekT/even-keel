import { isFinished, stuckSince, type CiView } from '../../src/ci/model.js'

export type CiLevel = 'error' | 'stuck' | 'failure' | 'off' | 'running' | 'success' | 'idle'

/** Most urgent first: the badge of several CIs shows the first level any of them has. */
const ORDER: CiLevel[] = ['error', 'stuck', 'failure', 'off', 'running', 'success', 'idle']

export function ciLevel(view: CiView, now: Date): CiLevel {
  if (view.health !== 'ok') return view.health
  if (stuckSince(view, now) !== null) return 'stuck'
  const run = view.current?.run
  if (view.pushed !== null || (run !== undefined && !isFinished(run.status))) return 'running'
  if (run?.status === 'success') return 'success'
  if (run?.status === 'failure') return 'failure'
  return 'idle'
}

export function worstCiLevel(views: CiView[], now: Date): CiLevel {
  const levels = new Set(views.map((view) => ciLevel(view, now)))
  return ORDER.find((level) => levels.has(level)) ?? 'idle'
}
