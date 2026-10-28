import type { ChainState, CurrentTask, DispatcherDeps, ReleaseReason, ReturnReason } from './model.js'
import type { HandoffSession } from './relay.js'
import { PROMPTS } from './prompts.js'

type ShelfDeps = Pick<DispatcherDeps, 'asked' | 'now' | 'midTurn' | 'handoff' | 'promptLanguage'>

/**
 * Remember a resting session on release: after an inactive status, a blocker or a skip it may need a handover.
 */
export function shelve(state: ChainState, deps: ShelfDeps, project: string, current: CurrentTask, reason?: ReleaseReason, blockers: string[] = []): void {
  const { task, sessionId } = current
  if (sessionId === null || deps.asked(task) !== null) return
  const shelved = (state.shelved[project] ?? []).filter((each) => each.task !== task)
  state.shelved[project] = [...shelved, { task, sessionId, at: deps.now().toISOString(),
    ...(reason === undefined ? {} : { reason }), ...(blockers.length === 0 ? {} : { blockers: [...blockers] }),
  }]
}

interface Returned {
  session: HandoffSession
  reason: ReturnReason
  extra?: string
}

/**
 * The session a shelved task left behind, to be replaced now the task is back (invariant 1, exceptions 9–10): only while
 * it is not mid-turn, waits on no question of its own and got no prompt or answer since — then someone talked to it.
 */
export function returned(state: ChainState, deps: ShelfDeps, project: string, task: string, live: string): Returned | undefined {
  const shelved = state.shelved[project]?.find((each) => each.task === task)
  if (shelved?.sessionId !== live || deps.midTurn(task) || deps.asked(task) !== null) return undefined
  const session = deps.handoff(task)
  if (session?.sessionId !== live) return undefined
  const since = Date.parse(shelved.at)
  const talked = session.recent.some((line) => (line.kind === 'prompt' || line.kind === 'answer') && Date.parse(line.at) > since)
  if (talked) return undefined
  const reason = shelved.reason === 'postpone' ? 'unblocked' : shelved.reason === 'skip' ? 'unskipped' : 'returned'
  const blockers = shelved.blockers ?? []
  const extra = reason === 'unblocked' && blockers.length > 0 ? { extra: PROMPTS[deps.promptLanguage(task)].blockersClosed(blockers) } : {}
  return { session, reason, ...extra }
}
