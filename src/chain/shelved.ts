import type { ChainState, CurrentTask, DispatcherDeps } from './model.js'
import type { HandoffSession } from './relay.js'

type ShelfDeps = Pick<DispatcherDeps, 'asked' | 'now' | 'midTurn' | 'handoff'>

/**
 * The current task left the chain for an inactive status (BTN-245) with no question of its own session open: most
 * likely the session asked in the tracker, so once the task is back a new session takes it (`returned`). A busy
 * session keeps its task in the chain (`enters`), so the task leaves only once the turn has ended.
 */
export function shelve(state: ChainState, deps: ShelfDeps, project: string, current: CurrentTask): void {
  const { task, sessionId } = current
  if (sessionId === null || deps.asked(task) !== null) return
  const shelved = (state.shelved[project] ?? []).filter((each) => each.task !== task)
  state.shelved[project] = [...shelved, { task, sessionId, at: deps.now().toISOString() }]
}

/**
 * The session a shelved task left behind, to be replaced now the task is back (invariant 1, exception 9): only while
 * it is not mid-turn, waits on no question of its own and got no prompt or answer since — then someone talked to it.
 */
export function returned(state: ChainState, deps: ShelfDeps, project: string, task: string, live: string): HandoffSession | undefined {
  const shelved = state.shelved[project]?.find((each) => each.task === task)
  if (shelved?.sessionId !== live || deps.midTurn(task) || deps.asked(task) !== null) return undefined
  const session = deps.handoff(task)
  if (session?.sessionId !== live) return undefined
  const since = Date.parse(shelved.at)
  const talked = session.recent.some((line) => (line.kind === 'prompt' || line.kind === 'answer') && Date.parse(line.at) > since)
  return talked ? undefined : session
}
