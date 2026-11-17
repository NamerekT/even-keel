import type { Task } from '../tracker/model.js'
import type { ActiveChain, ChainMachines, ChainState } from './model.js'

/** The project's lanes (BTN-993): its active chains in start order; the first is its head. */
export function lanesOf(state: ChainState, project: string): ActiveChain[] {
  return state.active.filter((chain) => chain.project === project)
}

export function laneMachine(chain: ActiveChain, machines: ChainMachines): string {
  return chain.machine ?? machines.own()
}

/** What a lane holds: its current task, the one it closes and the one a red main interrupted. */
export function laneTasks(chain: ActiveChain): string[] {
  return [chain.current?.task, chain.closing, chain.interrupted?.task].filter((task): task is string => task !== undefined)
}

/** The lane holding the task; `undefined` — none. */
export function laneOf(state: ChainState, project: string, task: string): ActiveChain | undefined {
  return lanesOf(state, project).find((chain) => laneTasks(chain).includes(task))
}

/** The lane whose current task it is, else the project's head lane. */
export function chainFor(state: ChainState, project: string, task: string): ActiveChain | undefined {
  const lanes = lanesOf(state, project)
  return lanes.find((chain) => chain.current?.task === task) ?? lanes[0]
}

/**
 * The lane ends without letting its task go (BTN-1270): the task stays with its machine's `machine_tasks` row, or went
 * elsewhere by hand. A project left with no lane goes to the head of the queue, so its chain goes on on another machine.
 */
export function leaveLane(state: ChainState, chain: ActiveChain): void {
  state.active = state.active.filter((each) => each !== chain)
  if (lanesOf(state, chain.project).length === 0 && !state.queue.includes(chain.project)) state.queue.unshift(chain.project)
}

/** The lanes on a revoked machine: nothing reaches their sessions any more. */
export function goneLanes(state: ChainState, machines: ChainMachines): ActiveChain[] {
  return state.active.filter((chain) => chain.machine !== undefined && machines.gone?.(chain.machine) === true)
}

/** A project takes another lane only while none of its lanes is paused, winding down or held by a red main. */
export function widens(lanes: ActiveChain[]): boolean {
  return lanes.every((chain) => !chain.paused && !chain.fixOnly && !chain.stopAfter && chain.interrupted === undefined)
}

/**
 * The tasks a lane must not take: those its sibling lanes hold, those another machine holds, those its machine cannot
 * run and, with "Lanes by component" on (BTN-1273), those of a component a sibling's task is in. `nextTask` holds back
 * what depends on them as well.
 */
export function heldFrom(state: ChainState, machines: ChainMachines, project: string, machine: string, tasks: Task[], lane?: ActiveChain): string[] {
  const siblings = lanesOf(state, project).filter((chain) => chain !== lane).flatMap(laneTasks)
  const others = tasks.filter(({ id }) => {
    const holder = machines.holder(project, id)
    return (holder !== undefined && holder !== machine) || !machines.runs(project, id, machine)
  })
  const busy = machines.componentLanes?.(project) === true ? componentsOf(tasks, siblings) : new Set<string>()
  const shared = tasks.filter((task) => task.component !== undefined && busy.has(task.component))
  return [...siblings, ...[...others, ...shared].map((task) => task.id)]
}

function componentsOf(tasks: Task[], ids: string[]): Set<string> {
  return new Set(tasks.flatMap((task) => (ids.includes(task.id) && task.component !== undefined ? [task.component] : [])))
}
