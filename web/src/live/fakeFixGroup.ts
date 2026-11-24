import { fixName } from '../../../src/chain/fix.js'
import { notice } from '../../../src/notice/notice.js'
import type { EvenKeelState, SessionView } from '../../../src/state.js'
import { withFix } from './fakeFix.js'
import { GROUP_STEPS, withGroupBase } from './fakeGroup.js'
import { ago, session } from './fakeSessions.js'

const LEAD = 'ABC-5'
const LANDED = '4e1d0c9b8a7f6e5d4c3b2a19f8e7d6c5b4a39281'

type Step = (state: EvenKeelState) => EvenKeelState

/**
 * `?chain=fixGroup` (BTN-1617): ABC runs on two machines in the group "Under way", ABC-5 on the workstation and ABC-8
 * on the home server, when main goes red mid-turn: ABC-5's session stops and the fix joins the group, ABC-5 stands under
 * it; then the fix lands and ABC-5 goes on. `&fixEnd=red` — main is red after the fix: ABC-5 is the paused chain's
 * current task with its stopped session, out of the group; then the chain resumes it.
 */
export function withFixGroupBase(state: EvenKeelState): EvenKeelState {
  return GROUP_STEPS[0]!(withGroupBase(state))
}

export function fixGroupSteps(end: string | null): Step[] {
  return [(state) => withFix(state, 'ABC', session(fixName('ABC'), 38_000), ago(0)), end === 'red' ? redAfterFix : landed, ...(end === 'red' ? [resumed] : [])]
}

/** The fix lands: its episode is over, and the head lane takes ABC-5's session back. */
function landed(state: EvenKeelState): EvenKeelState {
  return withLamp(handBack(state, false, 'landed'), LEAD, 'working')
}

/** Main is red after the fix: the head lane pauses with ABC-5 and its stopped session (`MainFix.giveBack`). */
function redAfterFix(state: EvenKeelState): EvenKeelState {
  return handBack(state, true, 'landed')
}

/** "Resume": the paused lane runs ABC-5 again. */
function resumed(state: EvenKeelState): EvenKeelState {
  const chain = { ...state.chain, active: state.chain.active.map((lane) => (lane.machine === 'pc' ? { ...lane, paused: false, error: null } : lane)) }
  return withLamp({ ...state, chain }, LEAD, 'working')
}

function handBack(state: EvenKeelState, paused: boolean, how: 'landed'): EvenKeelState {
  const head = state.chain.active.find((lane) => lane.machine === 'pc')
  const held = head?.interrupted
  if (head === undefined || held === undefined) return state
  const { interrupted: _, ...lane } = head
  const fix = fixName('ABC')
  const error = paused ? notice('ci.fixFailed', { task: fix, commit: LANDED.slice(0, 7) }) : null
  const back = { ...lane, current: { task: held.task, sessionId: held.sessionId, since: held.since }, paused, error }
  const episodes = (state.fixes.ABC ?? []).map((episode) => (episode.end === null ? { ...episode, end: { at: ago(0), how, commit: LANDED } } : episode))
  return {
    ...withLamp(state, fix, 'finished'),
    chain: { ...state.chain, active: state.chain.active.map((each) => (each === head ? back : each)) },
    fixes: { ...state.fixes, ABC: episodes },
  }
}

function withLamp(state: EvenKeelState, task: string, lamp: SessionView['lamp']): EvenKeelState {
  return { ...state, sessions: state.sessions.map((view) => (view.task === task ? { ...view, lamp, ...(lamp === 'working' && { lastActivityAt: ago(0) }) } : view)) }
}
