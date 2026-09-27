import { isOpen, type HulyTask } from '../huly/model.js'
import { byNumber, chainOrder, checkOrder, nextTask, openBlockers } from './order.js'
import { handoffPrompt, holdOf, relayStep, type AccountNow, type LimitedSession, type LimitHold, type RelayAction } from './relay.js'

export interface CurrentTask {
  task: string
  sessionId: string | null
  since: string
  limit?: LimitHold
}

export interface ActiveChain {
  project: string
  current: CurrentTask | null
  paused: boolean
  error: string | null
  limitUntil?: string
}

export interface ChainState {
  active: ActiveChain | null
  queue: string[]
  orders: Record<string, string[]>
  skipped: Record<string, string[]>
}

export type ReleaseReason = 'postpone' | 'skip'

export interface LaunchEntry {
  at: string
  project: string
  task: string
  sessionId: string
  reason?: RelayAction | ReleaseReason
  previous?: string
  blockers?: string[]
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
  busy: (task: string) => boolean
  save: (state: ChainState) => void
  journal: (entry: LaunchEntry) => void
  now: () => Date
  limited: (task: string) => LimitedSession | undefined
  account: () => AccountNow
  accountAt: (at: string) => string | null
  limitReset: () => string | null
  resume: (task: string, session: LimitedSession) => Promise<string>
  relay: (task: string, session: LimitedSession, prompt: string) => Promise<string>
}

export function emptyChainState(): ChainState {
  return { active: null, queue: [], orders: {}, skipped: {} }
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
    const placed = this.placeNew(project)
    if (this.forgetClosed(project) || placed) this.deps.save(this.state)
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

  skip(project: string, task: string): void {
    this.requireProject(project)
    if (!(this.tasks.get(project) ?? []).some((open) => open.id === task)) throw new Error(`chain: ${task} is not an open task of ${project}`)
    const active = this.state.active
    const holder = active?.project === project && active.current?.task === task ? active : null
    if (holder?.current?.sessionId === null) throw new Error(`chain: ${task} is still launching; try again in a moment`)
    if (holder !== null && this.deps.busy(task)) throw new Error(`chain: ${task} is mid-turn; wait until its session stops`)
    const skipped = (this.state.skipped[project] ??= [])
    if (!skipped.includes(task)) skipped.push(task)
    if (holder !== null) this.release(holder, 'skip', [])
    this.changed()
  }

  unskip(project: string, task: string): void {
    this.requireProject(project)
    const skipped = this.state.skipped[project]
    if (skipped === undefined || !skipped.includes(task)) return
    this.keepSkipped(project, skipped.filter((id) => id !== task))
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

  check(): void {
    this.kick()
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

  private forgetClosed(project: string): boolean {
    const skipped = this.state.skipped[project]
    if (skipped === undefined) return false
    const open = new Set((this.tasks.get(project) ?? []).map((task) => task.id))
    const kept = skipped.filter((id) => open.has(id))
    if (kept.length === skipped.length) return false
    this.keepSkipped(project, kept)
    return true
  }

  private keepSkipped(project: string, skipped: string[]): void {
    if (skipped.length === 0) delete this.state.skipped[project]
    else this.state.skipped[project] = skipped
  }

  private release(chain: ActiveChain, reason: ReleaseReason, blockers: string[]): void {
    const { task, sessionId } = chain.current!
    if (sessionId !== null) {
      const entry: LaunchEntry = { at: this.deps.now().toISOString(), project: chain.project, task, sessionId, reason }
      if (blockers.length > 0) entry.blockers = blockers
      this.deps.journal(entry)
    }
    chain.current = null
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
        if (!tasks.some((open) => open.id === task)) chain.current = null
        else {
          const blockers = openBlockers(tasks, task)
          if (blockers.length === 0 || this.deps.busy(task)) {
            await this.followLimit(chain, chain.current)
            return
          }
          this.release(chain, 'postpone', blockers)
          this.deps.save(this.state)
        }
      }

      let order: string[]
      try {
        order = chainOrder(tasks, this.state.orders[chain.project])
      } catch (error) {
        this.halt(chain, messageOf(error))
        return
      }

      const task = nextTask(tasks, order, this.state.skipped[chain.project] ?? [])
      if (task === undefined) {
        this.state.active = null
        this.deps.save(this.state)
        continue
      }

      const since = this.deps.now().toISOString()
      const live = this.deps.liveSession(task)
      if (live !== undefined) {
        delete chain.limitUntil
        chain.current = { task, sessionId: live, since }
        this.deps.save(this.state)
        return
      }

      const blocked = this.deps.blocked()
      if (blocked !== undefined) {
        this.halt(chain, blocked)
        return
      }

      const reset = this.deps.limitReset()
      if (reset !== null) {
        if (chain.limitUntil !== reset) {
          chain.limitUntil = reset
          this.deps.save(this.state)
        }
        return
      }

      delete chain.limitUntil
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

  private async followLimit(chain: ActiveChain, current: CurrentTask): Promise<void> {
    const session = this.deps.limited(current.task)
    if (session === undefined) {
      if (current.limit !== undefined && current.limit.acted === null) {
        delete current.limit
        this.deps.save(this.state)
      }
      return
    }
    if (current.limit?.at !== session.limit.at) {
      if (this.deps.account().email === null) return
      current.limit = holdOf(session, this.deps.accountAt(session.limit.at), this.deps.limitReset())
      this.deps.save(this.state)
    }
    const hold = current.limit
    const now = this.deps.now()
    const step = relayStep(hold, now, this.deps.account())
    if (step === 'wait') return

    hold.acted = step
    this.deps.save(this.state)
    try {
      const sessionId =
        step === 'resume'
          ? await this.deps.resume(current.task, session)
          : await this.deps.relay(current.task, session, handoffPrompt(current.task, session))
      this.deps.journal({
        at: now.toISOString(),
        project: chain.project,
        task: current.task,
        sessionId,
        reason: step,
        previous: session.sessionId,
      })
      current.sessionId = sessionId
      this.deps.save(this.state)
    } catch (error) {
      this.halt(chain, messageOf(error))
    }
  }

  private halt(chain: ActiveChain, error: string): void {
    chain.current = null
    chain.paused = true
    chain.error = error
    delete chain.limitUntil
    this.deps.save(this.state)
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
