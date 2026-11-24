import { fail } from '../notice/notice.js'
import type { MainCarry } from './carry.js'
import { isCarryName, isFixName } from './fix.js'
import type { TaskLists } from './lists.js'
import type { MainFix } from './mainfix.js'
import type { ActiveChain, ChainState, DispatcherDeps, ReleaseReason } from './model.js'
import { checkOrder, startsAhead } from './order.js'

export interface ArrangeHost {
  /** The project's head lane; with `task` — the lane holding it, else the head. */
  chainOf: (project: string, task?: string) => ActiveChain | undefined
  /** What every lane of the project runs (BTN-1611): its task, or the one a running fix of main interrupted. */
  runningOf: (project: string) => string[]
  requireProject: (project: string) => void
  release: (chain: ActiveChain, reason: ReleaseReason, blockers: string[]) => void
  /** Saves the state and steps the chains. */
  changed: () => void
}

/** What the user arranges from the page: the order of a chain's tasks and of the queue, the skips. */
export class Arrangement {
  constructor(
    private readonly state: ChainState,
    private readonly deps: DispatcherDeps,
    private readonly lists: TaskLists,
    private readonly fixes: MainFix | null,
    private readonly carries: MainCarry,
    private readonly host: ArrangeHost,
  ) {}

  skip(project: string, task: string): void {
    this.host.requireProject(project)
    if (this.fixes !== null && isFixName(task)) {
      this.fixes.skip(this.host.chainOf(project), task)
      this.host.changed()
      return
    }
    if (isCarryName(task)) {
      this.carries.skip(this.host.chainOf(project), task)
      this.host.changed()
      return
    }
    if (!(this.lists.tasks.get(project) ?? []).some((open) => open.id === task)) throw fail('chain.notOpen', { task, project })
    const chain = this.host.chainOf(project, task)
    const holder = chain !== undefined && chain.current?.task === task ? chain : null
    if (holder?.current?.sessionId === null) throw fail('chain.launching', { task })
    if (this.deps.machine.busy(task)) throw fail('chain.midTurn', { task })
    const skipped = (this.state.skipped[project] ??= [])
    if (!skipped.includes(task)) skipped.push(task)
    if (holder !== null) this.host.release(holder, 'skip', [])
    this.host.changed()
  }

  unskip(project: string, task: string): void {
    this.host.requireProject(project)
    const skipped = this.state.skipped[project]
    if (skipped === undefined || !skipped.includes(task)) return
    this.keepSkipped(project, skipped.filter((id) => id !== task))
    this.host.changed()
  }

  /**
   * The project's tasks got new ids (BTN-1074, its tracker switched): the saved order and the skips follow; an id without
   * a new one stays. Without a saved order the computed one is saved (BTN-1195): the new tracker may keep no priority and
   * numbers the tasks otherwise, so the same rules would build another order there. The order ranks the backlog and the
   * own waiting blockers too, after a manual order (BTN-1199): the new tracker may have no status to keep them out of the
   * chain, and unranked they would be new there and go to its head; those it keeps out `placed` drops.
   */
  rename(project: string, names: ReadonlyMap<string, string>): void {
    const renamed = (ids: string[]) => ids.map((id) => names.get(id) ?? id)
    const order = this.lists.kept(project)
    if (order !== undefined) this.state.orders[project] = renamed(order)
    if (this.state.skipped[project] !== undefined) this.state.skipped[project] = renamed(this.state.skipped[project])
    this.host.changed()
  }

  requeue(order: string[]): void {
    const queue = this.state.queue
    const same = order.length === queue.length && new Set(order).size === order.length && order.every((key) => queue.includes(key))
    if (!same) throw fail('chain.queueChanged', { queue: [...queue] })
    this.state.queue = [...order]
    this.host.changed()
  }

  reorder(project: string, order: string[]): void {
    this.host.requireProject(project)
    const tasks = this.lists.tasks.get(project) ?? []
    checkOrder(tasks, order)
    const running = this.host.runningOf(project).filter((id) => tasks.some((task) => task.id === id))
    const holding = [...(this.state.skipped[project] ?? []), ...this.lists.waitingIds(project), ...running]
    const ahead = running.find((current) => startsAhead(tasks, order, current, holding))
    if (ahead !== undefined) throw fail('chain.currentFirst', { task: ahead })
    this.state.orders[project] = [...order]
    this.host.changed()
  }

  /** Drops the skips of tasks no longer open; whether any was dropped. */
  forgetClosed(project: string): boolean {
    const skipped = this.state.skipped[project]
    if (skipped === undefined) return false
    const open = new Set((this.lists.tasks.get(project) ?? []).map((task) => task.id))
    const kept = skipped.filter((id) => open.has(id))
    if (kept.length === skipped.length) return false
    this.keepSkipped(project, kept)
    return true
  }

  private keepSkipped(project: string, skipped: string[]): void {
    if (skipped.length === 0) delete this.state.skipped[project]
    else this.state.skipped[project] = skipped
  }
}
