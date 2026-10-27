import { fail, NoticeError } from '../notice/notice.js'
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
