import type { ChainMachines } from '../chain/model.js'

export interface ChainMachineDeps {
  own: () => string
  /** The own machine's capacity: the `parallel` setting. */
  parallel: () => number
  /** The machines elsewhere that take tasks now — online, their sessions read — with their capacity. */
  peers: () => Array<{ id: string; capacity: number }>
  /** The machines of the project's pool, turned on; empty — the project has none named, so the own one runs it. */
  pool: (project: string) => readonly string[]
  /** The project's `width`. */
  width: (project: string) => number
  componentLanes?: ChainMachines['componentLanes']
  machineOf: (project: string, task: string) => string | undefined
  revoked: (machine: string) => boolean
  /** The machine elsewhere is on the link now. */
  connected?: (machine: string) => boolean
  /** The agent the task's sessions run on: its run's provider, else the project's. */
  agentOf: (project: string, task: string) => string
  /** The agents the machine has an account folder of; `undefined` — not known yet. */
  agents: (machine: string) => readonly string[] | undefined
  /** The machine said it has no folder of the account the task runs on (BTN-1311); absent — every machine has. */
  lacks?: (project: string, task: string, machine: string) => boolean
  /** The machines the task's run pins it to (BTN-1623); `undefined` or empty — any machine of the pool. */
  pinned?: (project: string, task: string) => readonly string[] | undefined
  /** The machine the task was moved off by hand (BTN-1270); `undefined` — it was not moved. */
  movedFrom?: (project: string, task: string) => string | undefined
  bind: (project: string, task: string, machine: string) => void
  switchOnLimit?: ChainMachines['switchOnLimit']
  hasLimit?: ChainMachines['hasLimit']
  limitMoved?: ChainMachines['limitMoved']
  /** The machine's folder of the project stands off its main branch (BTN-1567): it takes none of the project's tasks. */
  held?: (project: string, machine: string) => boolean
}

/**
 * The hub's machines as the chain's lanes see them (BTN-993, `docs/machines/pool.md`, "The pool"): the own machine first,
 * with `parallel` places, then each machine elsewhere online with its capacity. A machine runs a task when it has an
 * account of the task's agent and a folder of the account the task runs on (BTN-1311), or when no machine of the
 * project's pool has: with one machine the chain falls back to another agent, or pauses, as before. A task stays with
 * its machine while that one is away or revoked (BTN-1270), and a task moved off a machine by hand never goes back to it.
 * A task pinned to machines (BTN-1623) runs on none off its list, which it waits for while they are away or busy.
 * A machine whose folder of the project stands off the project's main branch does not serve it until it is back (BTN-1567).
 */
export function chainMachines(deps: ChainMachineDeps): ChainMachines {
  const serves = (project: string, machine: string): boolean => {
    const pool = deps.pool(project)
    return pool.length === 0 ? machine === deps.own() : pool.includes(machine) && deps.held?.(project, machine) !== true
  }
  const list = () => [{ id: deps.own(), capacity: deps.parallel() }, ...deps.peers()]
  return {
    own: deps.own,
    list,
    serves,
    width: (project) => Math.max(1, deps.width(project)),
    holder: deps.machineOf,
    gone: deps.revoked,
    ...(deps.connected === undefined ? {} : { online: (machine: string) => machine === deps.own() || deps.connected!(machine) }),
    runs: (project, task, machine) => {
      if (deps.movedFrom?.(project, task) === machine) return false
      // A pin takes a machine off the list out as if it could not run the task; the one holding it keeps it (BTN-1623).
      const pins = deps.pinned?.(project, task) ?? []
      const pinnedTo = (id: string) => pins.length === 0 || pins.includes(id) || deps.machineOf(project, task) === id
      if (!pinnedTo(machine)) return false
      const agent = deps.agentOf(project, task)
      const lacks = (id: string) => deps.lacks?.(project, task, id) === true
      const known = deps.agents(machine)
      if ((known === undefined || known.includes(agent)) && !lacks(machine)) return true
      return !list().some(({ id }) => id !== machine && serves(project, id) && pinnedTo(id) && deps.agents(id)?.includes(agent) === true && !lacks(id))
    },
    bind: deps.bind,
    ...(deps.componentLanes === undefined ? {} : { componentLanes: deps.componentLanes }),
    ...(deps.switchOnLimit === undefined ? {} : { switchOnLimit: deps.switchOnLimit }),
    ...(deps.hasLimit === undefined ? {} : { hasLimit: deps.hasLimit }),
    ...(deps.limitMoved === undefined ? {} : { limitMoved: deps.limitMoved }),
  }
}
