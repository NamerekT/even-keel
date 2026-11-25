import { laneMachine, laneOf, projectOn } from '../chain/lanes.js'
import type { ChainMachines, ChainState } from '../chain/model.js'
import type { PinWait } from '../state.js'

/** The machines a task of the project may be pinned to: the pool's turned on and not revoked, the own one of a project with none. */
export function pinnable(pool: readonly string[], live: readonly string[], own: string): string[] {
  const pinned = pool.filter((id) => live.includes(id))
  return pinned.length > 0 ? pinned : [own]
}

/**
 * What each pinned task of the project waits for, by task (`docs/machines/pool.md`, "A task pinned to machines"); a task that
 * waits for no machine of its list is not there. A machine off the list holding it is told even while it runs there.
 */
export function pinWaits(project: string, pins: Record<string, readonly string[]>, state: ChainState, machines: ChainMachines): Record<string, PinWait> {
  const online = new Map(machines.list().map(({ id, capacity }) => [id, capacity]))
  const busy = (id: string) => projectOn(state, machines, project, id) || state.active.filter((chain) => laneMachine(chain, machines) === id).length >= online.get(id)!
  const waits: Record<string, PinWait> = {}
  for (const [task, list] of Object.entries(pins)) {
    if (list.length === 0) continue
    const holder = machines.holder(project, task)
    if (holder !== undefined && !list.includes(holder)) {
      waits[task] = 'elsewhere'
      continue
    }
    if (laneOf(state, project, task) !== undefined) continue
    // A task stays with the machine holding it while that one is away (BTN-1270).
    const candidates = (holder === undefined ? list : [holder]).filter((id) => machines.serves(project, id) && machines.gone?.(id) !== true)
    if (candidates.length === 0) waits[task] = holder === undefined ? 'gone' : 'offline'
    else if (!candidates.some((id) => online.has(id))) waits[task] = 'offline'
    else if (candidates.every((id) => !online.has(id) || busy(id))) waits[task] = 'busy'
  }
  return waits
}
