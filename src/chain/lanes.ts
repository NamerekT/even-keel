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

/** A project takes another lane only while none of its lanes is paused, winding down or held by a red main. */
export function widens(lanes: ActiveChain[]): boolean {
  return lanes.every((chain) => !chain.paused && !chain.fixOnly && !chain.stopAfter && chain.interrupted === undefined)
}

/**
 * The tasks a lane must not take: those its sibling lanes hold, those another machine holds, and those its machine
 * cannot run. `nextTask` holds back what depends on them as well.
 */
export function heldFrom(state: ChainState, machines: ChainMachines, project: string, machine: string, open: string[], lane?: ActiveChain): string[] {
  const siblings = lanesOf(state, project).filter((chain) => chain !== lane).flatMap(laneTasks)
  const others = open.filter((task) => {
    const holder = machines.holder(project, task)
    return (holder !== undefined && holder !== machine) || !machines.runs(project, task, machine)
  })
  return [...siblings, ...others]
}
