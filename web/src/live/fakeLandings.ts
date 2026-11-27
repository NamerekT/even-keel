import type { EvenKeelState } from '../../../src/state.js'

/**
 * `landing=resolving`: project ABC's current task resolves its landing (BTN-1582); `landing=remote`: it waits for the
 * remote, the "Close without pushing" button beside it; `landing=underway`: its session ended its turn asking nothing and
 * its merge is being landed (BTN-1779).
 */
export function withFakeLanding(state: EvenKeelState, mode: string): EvenKeelState {
  const task = state.chain.active.find((lane) => lane.project === 'ABC')?.current?.task
  if (task === undefined) return state
  if (mode === 'underway') {
    const sessions = state.sessions.map((each) => each.task === task ? { ...each, lamp: 'waiting' as const, asking: false, ask: null, waitingFor: null, startupDialog: null } : each)
    return { ...state, sessions, chain: { ...state.chain, landings: { ...state.chain.landings, ABC: [{ task, underway: true }] } } }
  }
  const landing = mode === 'remote' ? { task, waitingRemote: true as const } : { task, resolving: true as const }
  return { ...state, chain: { ...state.chain, landings: { ...state.chain.landings, ABC: [landing] } } }
}

/** The landing of `task` gone, as `chain/closeUnpushed` leaves it before the task is closed. */
export function withoutLanding(state: EvenKeelState, project: string, task: string): EvenKeelState {
  const left = (state.chain.landings?.[project] ?? []).filter((each) => each.task !== task)
  const landings = { ...state.chain.landings }
  if (left.length === 0) delete landings[project]
  else landings[project] = left
  return { ...state, chain: { ...state.chain, landings } }
}
