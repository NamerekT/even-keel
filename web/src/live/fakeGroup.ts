import type { EvenKeelState, SessionView } from '../../../src/state.js'
import { fakeMachineColors } from './fakeMachines.js'
import { ago, session } from './fakeSessions.js'

/** How long each step of `?chain=group` stands before the next one comes. */
export const GROUP_STEP_MS = 3_000

const TAKEN = 'ABC-8'
const LEAD = 'ABC-5'

type Step = (state: EvenKeelState) => EvenKeelState

/**
 * `?chain=group` (BTN-1613): the running group "Under way" through its life. ABC runs on two machines; the home server
 * takes ABC-8 past the locked ABC-7, its session asks, fails, works again, stops after its turn and lets the task go,
 * takes it again, and then the workstation's ABC-5 is done.
 */
export function withGroupBase(state: EvenKeelState): EvenKeelState {
  const [active, ...rest] = state.chain.active
  if (active === undefined) return state
  const machineNames = { pc: 'Workstation', srv: 'Home server' }
  return {
    ...state,
    machineNames,
    ...fakeMachineColors(machineNames),
    chain: { ...state.chain, active: [{ ...active, machine: 'pc' }, { project: active.project, machine: 'srv', current: null, paused: false, error: null }, ...rest] },
  }
}

/** The steps after the base, in order; `&group=<n>` starts the page with the first `n` of them done. */
export const GROUP_STEPS: Step[] = [
  (state) => take(state),
  (state) => withLamp(state, TAKEN, 'waiting'),
  (state) => withLamp(state, TAKEN, 'error'),
  (state) => withLamp(state, TAKEN, 'working'),
  (state) => letGo(state),
  (state) => take(state),
  (state) => finishLead(state),
]

/** The home server takes ABC-8 from below the locked tasks: the dispatcher moves it to the chain's head, after ABC-5. */
function take(state: EvenKeelState): EvenKeelState {
  const project = state.chain.active[0]!.project
  const kept = state.chain.projects[project]!
  const order = kept.order.filter((id) => id !== TAKEN)
  order.splice(order.indexOf(LEAD) + 1, 0, TAKEN)
  const view = { ...session(TAKEN, 24_000), startedAt: ago(0), lastActivityAt: ago(0) }
  return {
    ...state,
    chain: {
      ...state.chain,
      active: state.chain.active.map((lane) => (lane.machine === 'srv' ? { ...lane, current: { task: TAKEN, sessionId: view.sessionId, since: ago(0) } } : lane)),
      projects: { ...state.chain.projects, [project]: { ...kept, order } },
    },
    sessions: [...state.sessions.filter((each) => each.task !== TAKEN), view],
  }
}

/** Stop after the turn: the lane lets ABC-8 go, and it goes back to its own place behind ABC-7. */
function letGo(state: EvenKeelState): EvenKeelState {
  const project = state.chain.active[0]!.project
  const kept = state.chain.projects[project]!
  const order = kept.order.filter((id) => id !== TAKEN)
  order.splice(order.indexOf('ABC-7') + 1, 0, TAKEN)
  return {
    ...withLamp(state, TAKEN, 'finished'),
    chain: {
      ...state.chain,
      active: state.chain.active.map((lane) => (lane.machine === 'srv' ? { ...lane, current: null } : lane)),
      projects: { ...state.chain.projects, [project]: { ...kept, order } },
    },
  }
}

/** ABC-5 is done on the workstation: it leaves the group for the closed tasks, and the lane waits for its next one. */
function finishLead(state: EvenKeelState): EvenKeelState {
  const project = state.chain.active[0]!.project
  const kept = state.chain.projects[project]!
  return {
    ...withLamp(state, LEAD, 'finished'),
    tasks: state.tasks.map((each) => (each.id === LEAD ? { ...each, status: { name: 'Done', category: 'Won' as const } } : each)),
    chain: {
      ...state.chain,
      active: state.chain.active.map((lane) => (lane.machine === 'pc' ? { ...lane, current: null } : lane)),
      projects: { ...state.chain.projects, [project]: { ...kept, order: kept.order.filter((id) => id !== LEAD) } },
    },
  }
}

function withLamp(state: EvenKeelState, task: string, lamp: SessionView['lamp']): EvenKeelState {
  const asked = lamp === 'waiting'
  return {
    ...state,
    sessions: state.sessions.map((view) =>
      view.task === task
        ? {
            ...view,
            lamp,
            waitingFor: asked ? 'permission' : null,
            apiError: lamp === 'error' ? 'The requested model is not supported.' : null,
            apiErrorKind: lamp === 'error' ? 'error' : null,
          }
        : view,
    ),
  }
}
