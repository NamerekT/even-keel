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
  machineOf: (project: string, task: string) => string | undefined
  revoked: (machine: string) => boolean
  /** The agent the task's sessions run on: its run's provider, else the project's. */
  agentOf: (project: string, task: string) => string
  /** The agents the machine has an account folder of; `undefined` — not known yet. */
  agents: (machine: string) => readonly string[] | undefined
  /** The machine the task was moved off by hand (BTN-1270); `undefined` — it was not moved. */
  movedFrom?: (project: string, task: string) => string | undefined
  bind: (project: string, task: string, machine: string) => void
}

/**
 * The hub's machines as the chain's lanes see them (BTN-993, `docs/machines.md`, "The pool"): the own machine first,
 * with `parallel` places, then each machine elsewhere online with its capacity. A machine runs a task when it has an
 * account of the task's agent, or when no machine of the project's pool has one: with one machine the chain falls back
 * to another agent as before. A task stays with its machine while that one is away or revoked (BTN-1270), and a task
 * moved off a machine by hand never goes back to it.
 */
export function chainMachines(deps: ChainMachineDeps): ChainMachines {
  const serves = (project: string, machine: string): boolean => {
    const pool = deps.pool(project)
    return pool.length === 0 ? machine === deps.own() : pool.includes(machine)
  }
  const list = () => [{ id: deps.own(), capacity: deps.parallel() }, ...deps.peers()]
  return {
    own: deps.own,
    list,
    serves,
    width: (project) => Math.max(1, deps.width(project)),
    holder: deps.machineOf,
    gone: deps.revoked,
    runs: (project, task, machine) => {
      if (deps.movedFrom?.(project, task) === machine) return false
      const agent = deps.agentOf(project, task)
      const known = deps.agents(machine)
      if (known === undefined || known.includes(agent)) return true
      return !list().some(({ id }) => id !== machine && serves(project, id) && deps.agents(id)?.includes(agent) === true)
    },
    bind: deps.bind,
  }
}
