import type { ChainState, CurrentTask, DispatcherDeps } from './model.js'

const UNANSWERED_MS = 10 * 60_000

type QuietDeps = Pick<DispatcherDeps, 'machine' | 'now'>

/**
 * Unattended, the session of the current task has been quiet ten minutes without a limit, a checkpoint or a question
 * of the model's own: the chain skips the task (`docs/chain/unattended.md`). The hub's decision, read from the mirror.
 */
export function unanswered(state: ChainState, deps: QuietDeps, current: CurrentTask): boolean {
  if (current.sessionId !== null && deps.machine.modelRefusal?.(current.task, current.sessionId) !== undefined) return false
  const paidWait = current.limit?.acted === null && current.limit.overage !== undefined
  if (!state.unattended || paidWait || deps.machine.midTurn(current.task) || deps.machine.limited(current.task) !== undefined) return false
  const session = deps.machine.handoff(current.task)
  if (session === undefined || session.sessionId !== current.sessionId || session.checkpoint !== null) return false
  const moments = [current.since, current.resumedAt, session.lastReplyAt].filter((at) => at != null)
  const quietSince = Math.max(...moments.map((at) => Date.parse(at)))
  return deps.now().getTime() - quietSince >= UNANSWERED_MS
}

/** Unattended, the chain does not wait past ten quiet minutes for a session of a done task; the sweep cleans up after it. */
export function quietTooLong(state: ChainState, deps: QuietDeps, task: string): boolean {
  const lastReplyAt = deps.machine.handoff(task)?.lastReplyAt
  if (!state.unattended || lastReplyAt == null) return false
  return deps.now().getTime() - Date.parse(lastReplyAt) >= UNANSWERED_MS
}
