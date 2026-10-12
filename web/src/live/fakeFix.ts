import { fixName } from '../../../src/chain/fix.js'
import type { EvenKeelState, SessionView } from '../../../src/state.js'

const RED = '9f77142a5c0e3d1b7e6f4a2c8d9b0e1f2a3b4c5d'

/** `?chain=fix`: main went red while the current task was mid-turn — its session is stopped and the fix session leads the chain. */
export function withFix(state: EvenKeelState, project: string, fixing: SessionView, at: string): EvenKeelState {
  const active = state.chain.active.find((chain) => chain.project === project)
  const held = active?.current
  if (active === undefined || held == null || held.sessionId === null) return state
  const fix = fixName(project)
  const interrupted = { task: held.task, sessionId: held.sessionId, since: held.since, at, commit: RED }
  const leading = { ...active, current: { task: fix, sessionId: fixing.sessionId, since: at }, interrupted }
  const stopped = (view: SessionView): SessionView => ({ ...view, lamp: 'finished', remoteUrl: null, remoteOff: 'no-bridge' })
  return {
    ...state,
    chain: { ...state.chain, active: state.chain.active.map((chain) => (chain === active ? leading : chain)) },
    sessions: [...state.sessions.map((view) => (view.task === held.task ? stopped(view) : view)), { ...fixing, task: fix, startedAt: at }],
    taskSessions: { ...state.taskSessions, [fix]: [{ sessionId: fixing.sessionId, at, how: 'launch', resumed: 0, account: fixing.account }] },
  }
}
