import { fail, NoticeError } from '../notice/notice.js'
import { isOwnName } from './fix.js'
import type { ActiveChain, ChainState, CurrentTask, DispatcherDeps } from './model.js'
import type { HandoffSession } from './relay.js'
import { requireLimit } from './limitNotice.js'

export function answerable(
  state: ChainState,
  deps: DispatcherDeps,
  project: string,
  task: string,
  sessionId: string,
  ask: string | null,
  takes = false,
): { chain: ActiveChain | null; current: CurrentTask | null; session: HandoffSession; midTurn: boolean } {
  if (!deps.projects().includes(project)) throw fail('chain.unknownProject', { project })
  const chain = state.active.find((chain) => chain.project === project) ?? null
  const current = chain?.current?.task === task ? chain.current : null
  if (chain !== null && current === null) throw fail('chain.notCurrent', { task })
  if (current !== null && (current.sessionId === null || current.starting !== undefined)) throw fail('chain.launching', { task })
  const session = deps.handoff(task)
  if ((current !== null && current.sessionId !== sessionId) || session?.sessionId !== sessionId || deps.asked(task) !== ask) {
    throw fail('answer.moved', { task })
  }
  if (deps.midTurn(task)) {
    if (!takes || ask !== null) throw fail('answer.busy', { task })
    return { chain, current, session, midTurn: true }
  }
  const reason = deps.blocked(project, task)
  if (reason !== undefined) throw new NoticeError(reason)
  requireLimit(deps, project, task)
  return { chain, current, session, midTurn: false }
}

/**
 * Throws unless the user may take the last message of the task's session for its answer ("Accept as answer",
 * BTN-885): the task is a tracker task current in its chain, its session is the one the user saw, its turn has ended
 * and it asks nothing. The message to comment is returned.
 */
export function acceptable(
  state: ChainState,
  deps: DispatcherDeps,
  project: string,
  task: string,
  sessionId: string,
): { chain: ActiveChain; current: CurrentTask; session: HandoffSession; message: string } {
  if (!deps.projects().includes(project)) throw fail('chain.unknownProject', { project })
  const chain = state.active.find((chain) => chain.project === project)
  const current = chain?.current?.task === task ? chain.current : null
  if (chain === undefined || current === null || isOwnName(task)) throw fail('chain.notCurrent', { task })
  if (current.sessionId === null || current.starting !== undefined) throw fail('chain.launching', { task })
  const session = deps.handoff(task)
  if (current.sessionId !== sessionId || session?.sessionId !== sessionId) throw fail('answer.moved', { task })
  if (deps.busy(task)) throw fail('chain.midTurn', { task })
  if (deps.asked(task) !== null) throw fail('accept.asking', { task })
  const message = session.lastMessage?.trim() ?? ''
  if (message === '') throw fail('accept.noMessage', { task })
  return { chain, current, session, message }
}
