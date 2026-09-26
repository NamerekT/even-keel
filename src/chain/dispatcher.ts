import { isOpen, type HulyTask } from '../huly/model.js'
import { byNumber, chainOrder, checkOrder } from './order.js'

export interface CurrentTask {
  task: string
  sessionId: string | null
  since: string
}

export interface ActiveChain {
  project: string
  current: CurrentTask | null
  paused: boolean
  error: string | null
}

export interface ChainState {
  active: ActiveChain | null
  queue: string[]
  orders: Record<string, string[]>
}

export interface LaunchEntry {
  at: string
  project: string
  task: string
  sessionId: string
}

export interface ProjectOrder {
  order: string[]
  error: string | null
}

export interface DispatcherDeps {
  projects: string[]
  launch: (project: string, task: string) => Promise<string>
  liveSession: (task: string) => string | undefined
  blocked: () => string | undefined
  save: (state: ChainState) => void
  journal: (entry: LaunchEntry) => void
  now: () => Date
}

export function emptyChainState(): ChainState {
  return { active: null, queue: [], orders: {} }
}

export class Dispatcher {
  private readonly tasks = new Map<string, HulyTask[]>()
  private work: Promise<void> = Promise.resolve()

  constructor(
    readonly state: ChainState,
    private readonly deps: DispatcherDeps,
  ) {}

  setTasks(project: string, tasks: HulyTask[]): void {
    this.tasks.set(project, tasks.filter((task) => isOpen(task.status)))
    if (this.placeNew(project)) this.deps.save(this.state)
    this.kick()
  }

  start(project: string): void {
    this.requireProject(project)
    const { active, queue } = this.state
    if (active?.project === project || queue.includes(project)) return
    if (active === null) {
      this.requireLaunches()
      this.state.active = { project, current: null, paused: false, error: null }
    } else queue.push(project)
    this.changed()
  }

  pause(): void {
    if (this.state.active === null || this.state.active.paused) return
    this.state.active.paused = true
    this.changed()
  }

  resume(): void {
    if (this.state.active === null) return
    this.requireLaunches()
    this.state.active.paused = false
    this.state.active.error = null
    this.changed()
  }

  stop(): void {
    if (this.state.active === null) return
    this.state.active = null
    this.changed()
  }

  dequeue(project: string): void {
    const index = this.state.queue.indexOf(project)
    if (index < 0) return
    this.state.queue.splice(index, 1)
    this.changed()
  }

  requeue(order: string[]): void {
    const queue = this.state.queue
    const same = order.length === queue.length && new Set(order).size === order.length && order.every((key) => queue.includes(key))
    if (!same) throw new Error(`chain: the queue has changed, it is now ${queue.join(', ') || 'empty'}`)
    this.state.queue = [...order]
    this.changed()
  }

  reorder(project: string, order: string[]): void {
    this.requireProject(project)
    const tasks = this.tasks.get(project) ?? []
    checkOrder(tasks, order)
    const current = this.currentOf(project)
    if (current !== undefined && tasks.some((task) => task.id === current) && order[0] !== current) {
      throw new Error(`chain: ${current} is running and stays first`)
    }
    this.state.orders[project] = [...order]
    this.changed()
  }

  orders(): Record<string, ProjectOrder> {
    const result: Record<string, ProjectOrder> = {}
    for (const [project, tasks] of this.tasks) {
      try {
        result[project] = { order: chainOrder(tasks, this.preferred(project)), error: null }
      } catch (error) {
        result[project] = { order: [], error: messageOf(error) }
      }
    }
    return result
  }

  idle(): Promise<void> {
    return this.work
  }

  private requireProject(project: string): void {
    if (!this.deps.projects.includes(project)) throw new Error(`chain: ${project} is not a configured project`)
  }

  private currentOf(project: string): string | undefined {
    const active = this.state.active
    return active?.project === project ? active.current?.task : undefined
  }

  private preferred(project: string, stored = this.state.orders[project]): string[] | undefined {
    const current = this.currentOf(project)
    if (stored === undefined || current === undefined) return stored
    return [current, ...stored.filter((id) => id !== current)]
  }

  private placeNew(project: string): boolean {
    const stored = this.state.orders[project]
    if (stored === undefined) return false
    const tasks = this.tasks.get(project) ?? []
    const open = new Set(tasks.map((task) => task.id))
    const kept = stored.filter((id) => open.has(id))
    const fresh = [...open].filter((id) => !stored.includes(id)).sort(byNumber)
    if (fresh.length === 0 && kept.length === stored.length) return false

    const base = this.preferred(project, kept)!.filter((id) => open.has(id))
    const current = this.currentOf(project)
    base.splice(current !== undefined && base[0] === current ? 1 : 0, 0, ...fresh)
    try {
      this.state.orders[project] = chainOrder(tasks, base)
    } catch {
      this.state.orders[project] = base
    }
    return true
  }

  private requireLaunches(): void {
    const reason = this.deps.blocked()
    if (reason !== undefined) throw new Error(reason)
  }

  private changed(): void {
    this.deps.save(this.state)
    this.kick()
  }

  private kick(): void {
    this.work = this.work.then(() => this.advance())
  }

  private async advance(): Promise<void> {
    for (;;) {
      const chain = this.state.active
      if (chain === null) {
        const next = this.state.queue.shift()
        if (next === undefined) return
        this.state.active = { project: next, current: null, paused: false, error: null }
        this.deps.save(this.state)
        continue
      }
      if (chain.paused) return
      const tasks = this.tasks.get(chain.project)
      if (tasks === undefined) return

      if (chain.current !== null) {
        const { task, sessionId } = chain.current
        if (sessionId === null) {
          this.halt(chain, `chain: launch of ${task} was interrupted by a restart; check its session, then resume`)
          return
        }
        if (tasks.some((open) => open.id === task)) return
        chain.current = null
      }

      let order: string[]
      try {
        order = chainOrder(tasks, this.state.orders[chain.project])
      } catch (error) {
        this.halt(chain, messageOf(error))
        return
      }

      const task = order[0]
      if (task === undefined) {
        this.state.active = null
        this.deps.save(this.state)
        continue
      }

      const since = this.deps.now().toISOString()
      const live = this.deps.liveSession(task)
      if (live !== undefined) {
        chain.current = { task, sessionId: live, since }
        this.deps.save(this.state)
        return
      }

      const blocked = this.deps.blocked()
      if (blocked !== undefined) {
        this.halt(chain, blocked)
        return
      }

      chain.current = { task, sessionId: null, since }
      this.deps.save(this.state)
      try {
        const sessionId = await this.deps.launch(chain.project, task)
        this.deps.journal({ at: since, project: chain.project, task, sessionId })
        chain.current.sessionId = sessionId
        this.deps.save(this.state)
      } catch (error) {
        this.halt(chain, messageOf(error))
      }
      return
    }
  }

  private halt(chain: ActiveChain, error: string): void {
    chain.current = null
    chain.paused = true
    chain.error = error
    this.deps.save(this.state)
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
