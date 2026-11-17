import type { ActiveChain } from '../../src/chain/dispatcher.js'
import type { TaskSession } from '../../src/chain/launches.js'
import type { EvenKeelState } from '../../src/state.js'

/** The project's lanes (BTN-993): its active chains, the head first. */
export function lanesOf(chain: EvenKeelState['chain'], project: string): ActiveChain[] {
  return chain.active.filter((each) => each.project === project)
}

/** The lane whose current task it is; `undefined` — none. */
export function laneOfTask(lanes: ActiveChain[], task: string): ActiveChain | undefined {
  return lanes.find((lane) => lane.current?.task === task)
}

/** A machine a task ran on: its page's id, the hub's name and colour (BTN-1272; none — an older service). */
export interface TaskMachine {
  id: string
  name: string
  color?: string
}

/**
 * The machines a task ran on, oldest first, the one of its lane now last: `ПК → Сервер` after a move. `undefined`
 * where the hub has one machine or none, or no machine of the task is known: the page shows none then.
 */
export function taskMachines(state: Pick<EvenKeelState, 'machineNames' | 'machineColors'>, sessions: TaskSession[], lane: ActiveChain | undefined): TaskMachine[] | undefined {
  const names = state.machineNames
  if (names === undefined || Object.keys(names).length < 2) return undefined
  const ids = [...sessions].reverse().flatMap((session) => (session.machine === undefined ? [] : [session.machine]))
  if (lane?.machine !== undefined && lane.machine !== '') ids.push(lane.machine)
  const shown = ids.filter((id, index, all) => index === 0 || all[index - 1] !== id).map((id) => {
    const color = state.machineColors?.[id]
    return { id, name: names[id] ?? id, ...(color !== undefined && { color }) }
  })
  return shown.length === 0 ? undefined : shown
}
