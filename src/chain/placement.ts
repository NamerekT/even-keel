import type { Task } from '../tracker/model.js'
import { heldFrom, laneMachine, lanesOf, projectOn, widens } from './lanes.js'
import type { TaskLists } from './lists.js'
import type { MainCheck } from './maincheck.js'
import { newChain, type ActiveChain, type ChainMachines, type ChainState, type DispatcherDeps } from './model.js'
import { chainOrder, nextTask } from './order.js'
import type { Reviews } from './reviews.js'

// Which task a lane takes next and on which machine a new lane goes (BTN-993): the dispatcher's fill of the queue.
export class LanePlacement {
  constructor(
    private readonly state: ChainState,
    private readonly deps: DispatcherDeps,
    private readonly lists: TaskLists,
    private readonly main: MainCheck | null,
    private readonly reviews: Reviews,
  ) {}

  /**
   * The task the chain takes next by its list, the fix of a red main first; `undefined` — none. Throws on a broken order.
   * With `machine` — what a lane on it may take (BTN-993): no task another lane or machine holds, none it cannot run,
   * and the fix of main only in the project's head lane.
   */
  nextOf(project: string, tasks: Task[], machine?: string, lane?: ActiveChain): string | undefined {
    const order = chainOrder(tasks, this.state.orders[project])
    const skipped = this.state.skipped[project] ?? []
    const machines = this.deps.machines
    const listed = tasks.map((task) => task.id)
    const held = machines === undefined || machine === undefined ? [] : heldFrom(this.state, machines, project, machine, tasks, lane)
    const open = listed.filter((id) => !skipped.includes(id) && !held.includes(id))
    const lanes = lanesOf(this.state, project)
    const head = machine === undefined || lanes.length === 0 || lanes[0] === lane
    return (head ? this.main?.fixOf(project, open) : undefined) ?? this.reviews.next(project, open) ?? nextTask(tasks, order, [...skipped, ...this.lists.waitingIds(project), ...held])
  }

  /** The machine whose capacity the lane takes; `undefined` — no machines, only `parallel` counts. */
  machineOf(chain: ActiveChain): string | undefined {
    return this.deps.machines === undefined ? undefined : laneMachine(chain, this.deps.machines)
  }

  /**
   * The machine a new lane of the project goes to (BTN-993): the first listed one with a free place that serves the
   * project, runs no lane of it yet (BTN-1569: a machine holds one task of a project) and has a task of it to run — a
   * project with lanes already only while they all go plainly and fewer than its width. A project whose tasks no
   * machine can take now goes to none; `undefined` — no machine takes it now.
   */
  placeFor(project: string, only?: string): string | undefined {
    const machines = this.deps.machines!
    const lanes = lanesOf(this.state, project)
    if (lanes.length > 0 && (lanes.length >= machines.width(project) || !widens(lanes))) return undefined
    for (const { id, capacity } of machines.list()) {
      if (only !== undefined && id !== only) continue
      if (projectOn(this.state, machines, project, id)) continue
      if (this.state.active.filter((chain) => this.machineOf(chain) === id).length >= capacity || !machines.serves(project, id)) continue
      if (this.readyOn(project, id, lanes.length === 0)) return id
    }
    return undefined
  }

  /** The project has a task a new lane on the machine may take; a first lane goes also when no machine has one, to end or halt as before. */
  private readyOn(project: string, machine: string, first: boolean): boolean {
    const tasks = this.lists.tasks.get(project)
    if (tasks === undefined) return first
    try {
      if (this.nextOf(project, tasks, machine) !== undefined) return true
      return first && this.nextOf(project, tasks) === undefined && this.main?.sessionFix(project) === undefined
    } catch {
      return first
    }
  }

  /**
   * Takes queued projects while fewer chains than `parallel` are active; a lowered `parallel` stops nothing that runs.
   * With machines (BTN-993) each machine with a free place pulls: the first project by the chain's order — the active
   * ones, then the queue — that `placeFor` gives it gets a lane there.
   */
  fill(): void {
    if (this.deps.machines !== undefined) {
      this.pull(this.deps.machines)
      return
    }
    let taken = false
    while (this.state.active.length < this.deps.parallel()) {
      const next = this.state.queue.shift()
      if (next === undefined) break
      this.state.active.push(newChain(next))
      taken = true
    }
    if (taken) this.deps.save(this.state)
  }

  private pull(machines: ChainMachines): void {
    let taken = false
    for (const { id } of machines.list()) {
      for (;;) {
        const projects = [...new Set([...this.state.active.map((chain) => chain.project), ...this.state.queue])]
        const project = projects.find((each) => this.placeFor(each, id) === id)
        if (project === undefined) break
        const queued = this.state.queue.indexOf(project)
        if (queued >= 0) this.state.queue.splice(queued, 1)
        if (lanesOf(this.state, project).length > 0) this.deps.log(`chain: ${project} takes another lane, on machine ${id}`)
        this.state.active.push({ ...newChain(project), machine: id })
        taken = true
      }
    }
    if (taken) this.deps.save(this.state)
  }
}
