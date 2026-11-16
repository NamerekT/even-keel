import type { AgentEntry } from './agents.js'
import type { SessionView } from '../state.js'

/**
 * Lookups over the monitor's views and the agents' list, built once per list: the machine's facts ask them for every
 * task on each pass, and a scan of a thousand finished sessions per question held the service's thread (BTN-1254).
 * Both lists are replaced whole on each tick, never changed in place, so a list is its own key.
 */
interface ViewIndex {
  /** By task, its first view that has not finished, as `find` over the list gives it. */
  live: Map<string, SessionView>
  /** By task and session id, the first view of the pair. */
  pair: Map<string, SessionView>
}

interface AgentIndex {
  /** By session id, the first agent of the session. */
  first: Map<string, AgentEntry>
  steering: Set<string>
}

const views = new WeakMap<readonly SessionView[], ViewIndex>()
const agents = new WeakMap<readonly AgentEntry[], AgentIndex>()

const pairKey = (task: string, sessionId: string): string => `${task}\n${sessionId}`

function viewIndex(list: readonly SessionView[]): ViewIndex {
  const known = views.get(list)
  if (known !== undefined) return known
  const index: ViewIndex = { live: new Map(), pair: new Map() }
  for (const view of list) {
    if (view.lamp !== 'finished' && !index.live.has(view.task)) index.live.set(view.task, view)
    const key = pairKey(view.task, view.sessionId)
    if (!index.pair.has(key)) index.pair.set(key, view)
  }
  views.set(list, index)
  return index
}

function agentIndex(list: readonly AgentEntry[]): AgentIndex {
  const known = agents.get(list)
  if (known !== undefined) return known
  const index: AgentIndex = { first: new Map(), steering: new Set() }
  for (const agent of list) {
    if (!index.first.has(agent.sessionId)) index.first.set(agent.sessionId, agent)
    if (agent.steers === true) index.steering.add(agent.sessionId)
  }
  agents.set(list, index)
  return index
}

/** The task's session that has not finished. */
export const liveViewOf = (list: readonly SessionView[], task: string): SessionView | undefined => viewIndex(list).live.get(task)

export const viewOf = (list: readonly SessionView[], task: string, sessionId: string): SessionView | undefined => viewIndex(list).pair.get(pairKey(task, sessionId))

export const agentOfSession = (list: readonly AgentEntry[], sessionId: string): AgentEntry | undefined => agentIndex(list).first.get(sessionId)

/** Whether an agent of the session is steered through its mailbox. */
export const steers = (list: readonly AgentEntry[], sessionId: string): boolean => agentIndex(list).steering.has(sessionId)
