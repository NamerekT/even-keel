import { laneMachine } from './lanes.js'
import type { ActiveChain, ChainState, DispatcherDeps } from './model.js'

/**
 * With the switch "Go on where a limit is left" on (BTN-996, `docs/machines.md`, "Past a limit"), a lane whose next
 * task would wait out its machine's limit goes to another machine of the project's pool that has a free place, can
 * run the task and has limit left for it. Only a task never launched moves: one launched stays with its machine, its
 * worktree and its sessions. The switch off, the lane waits on its machine, as does a project of width 1 with it.
 * `true` — the lane moved, its task bound to the new machine.
 */
export function moveOffLimit(state: ChainState, deps: DispatcherDeps, chain: ActiveChain, task: string): boolean {
  const machines = deps.machines
  if (machines === undefined || machines.switchOnLimit?.() !== true || machines.hasLimit === undefined) return false
  const spent = deps.machine.limitReset(chain.project, task) !== null || (deps.machine.modelWeek?.(chain.project, task) ?? null) !== null
  if (!spent) return false
  // A port that keeps no launch journal cannot tell a task never launched: it stays.
  if (deps.machine.lastSession === undefined || deps.machine.lastSession(chain.project, task) !== undefined) return false
  const from = laneMachine(chain, machines)
  const taken = (machine: string) => state.active.filter((each) => laneMachine(each, machines) === machine).length
  const to = machines.list().find(({ id, capacity }) =>
    id !== from && taken(id) < capacity && machines.serves(chain.project, id) && machines.runs(chain.project, task, id) && machines.hasLimit!(chain.project, task, id))
  if (to === undefined) return false
  chain.machine = to.id
  machines.bind(chain.project, task, to.id)
  delete chain.limitUntil
  delete chain.modelWeek
  deps.log(`chain: ${task} goes to machine ${to.id}: the limit of machine ${from} is spent, and the switch to go on where a limit is left is on`)
  machines.limitMoved?.(chain.project, task, from, to.id)
  deps.save(state)
  return true
}
