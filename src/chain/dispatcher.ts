import type { FinishOutcome } from '../git/types.js'
import type { Language } from '../language.js'
import { fail, notice, NoticeError, noticeOf, type Notice } from '../notice/notice.js'
import { isOpen, type Task } from '../tracker/model.js'
import { byNumber, chainOrder, checkOrder, nextTask, openBlockers, waitingBlockers, withFresh } from './order.js'
import { admits, excludes, isActive, isDone, isTerminal, type ChainRules } from './rules.js'
import {
  handoffPrompt,
  holdOf,
  relayStep,
  type AccountNow,
  type HandoffReason,
  type HandoffSession,
  type LimitedSession,
  type LimitHold,
  type RelayAction,
} from './relay.js'

const UNANSWERED_MS = 10 * 60_000

export interface CurrentTask {
  task: string
  sessionId: string | null
  since: string
  resumedAt?: string
  limit?: LimitHold
  /** When the dispatcher began launching or handing the task over; gone once the new session id is known. */
  starting?: string
}

export interface ActiveChain {
  project: string
  current: CurrentTask | null
  paused: boolean
  error: Notice | null
  limitUntil?: string
  closing?: string
}

export interface Leftover {
  task: string
  at: string
  notice: Notice
}

export interface ChainState {
  /** Running and paused chains in start order; at most `parallel` of them take new chains from the queue. */
  active: ActiveChain[]
  queue: string[]
  orders: Record<string, string[]>
  skipped: Record<string, string[]>
  leftovers: Record<string, Leftover[]>
  released: Record<string, string[]>
  unattended: boolean
  /** Chain sessions start without claude.ai skills and plugins and with the hidden skills only for `/name`. */
  trimTools: boolean
}

export type ReleaseReason = 'postpone' | 'skip'

export interface LaunchEntry {
  at: string
  project: string
  task: string
  sessionId: string
  reason?: RelayAction | ReleaseReason | 'restart' | 'checkpoint'
  previous?: string
  blockers?: string[]
}

export interface ProjectOrder {
  order: string[]
  waiting: string[]
  /** The waiting blockers missing from the project task list (parents, other projects); set when there are any. */
  outside?: Task[]
  /** Open tasks the chain does not take yet by their status or a missing required label, and that no chain task waits on. */
  backlog: string[]
  /**
   * For the backlog tasks the chain would take once their status is active: the chain task each would stand right before,
   * `null` for the end. Set when there are any.
   */
  landing?: Record<string, string | null>
  error: Notice | null
}

export interface DispatcherDeps {
  projects: string[]
  /** How many chains run at once; the rest wait in the queue. */
  parallel: () => number
  rules: (project: string) => ChainRules
  launch: (project: string, task: string) => Promise<string>
  liveSession: (task: string) => string | undefined
  blocked: () => Notice | undefined
  busy: (task: string) => boolean
  midTurn: (task: string) => boolean
  save: (state: ChainState) => void
  journal: (entry: LaunchEntry) => void
  now: () => Date
  limited: (task: string) => LimitedSession | undefined
  handoff: (task: string) => HandoffSession | undefined
  locate: (session: HandoffSession) => Promise<HandoffSession>
  account: () => AccountNow
  accountAt: (account: string, at: string) => string | null
  limitReset: () => string | null
  promptLanguage: () => Language
  resume:(task: string, session: LimitedSession) => Promise<string>
  relay: (task: string, session: HandoffSession, prompt: string) => Promise<string>
  finish: (project: string, task: string) => Promise<FinishOutcome>
}

export function emptyChainState(): ChainState {
  return { active: [], queue: [], orders: {}, skipped: {}, leftovers: {}, released: {}, unattended: false, trimTools: true }
}

function newChain(project: string): ActiveChain {
  return { project, current: null, paused: false, error: null }
}

export class Dispatcher {
  private readonly tasks = new Map<string, Task[]>()
  private readonly waiting = new Map<string, Task[]>()
  private readonly outside = new Map<string, Task[]>()
  private readonly backlog = new Map<string, Task[]>()
  private readonly done = new Map<string, Set<string>>()
  private readonly releasedDone = new Map<string, Set<string>>()
  private work: Promise<void> = Promise.resolve()

  constructor(
    readonly state: ChainState,
    private readonly deps: DispatcherDeps,
  ) {}

  setTasks(project: string, tasks: Task[]): void {
    const rules = this.deps.rules(project)
    const admitted = tasks.filter((task) => admits(rules, task))
    const chain = admitted.filter((task) => this.enters(project, task, rules))
    const outside = (this.outside.get(project) ?? []).filter((task) => isOpen(task.status))
    const waiting = waitingBlockers(chain, [...tasks, ...outside].filter((task) => !isTerminal(rules, task.status) && !chain.includes(task)))
    const backlog = tasks.filter((task) => !excludes(rules, task) && !chain.includes(task) && !waiting.includes(task))
    this.tasks.set(project, chain)
    this.waiting.set(project, waiting)
    this.backlog.set(project, backlog.sort((a, b) => byNumber(a.id, b.id)))
    this.done.set(project, new Set(tasks.filter((task) => isDone(rules, task.status)).map((task) => task.id)))
    const placed = this.placeNew(project)
    if (this.forgetClosed(project) || placed) this.deps.save(this.state)
    this.kick()
  }

  /** Blockers of the project tasks that its task list lacks: open parents and tasks of other projects, whatever their status. */
  setOutside(project: string, tasks: Task[]): void {
    this.outside.set(project, tasks)
  }

  released(project: string): string[] {
    return [...(this.state.released[project] ?? [])]
  }

  held(project: string): string[] {
    const current = this.chainOf(project)?.current
    const holds = current?.sessionId ? [current.task] : []
    return [...holds, ...this.released(project).filter((id) => !holds.includes(id))]
  }

  setReleased(project: string, tasks: Task[]): void {
    const rules = this.deps.rules(project)
    const statuses = new Map(tasks.map((task) => [task.id, task.status]))
    const kept = this.released(project).filter((id) => {
      const status = statuses.get(id)
      return status !== undefined && (isDone(rules, status) || !isTerminal(rules, status))
    })
    this.releasedDone.set(project, new Set(kept.filter((id) => isDone(rules, statuses.get(id)!))))
    if (kept.length !== this.released(project).length) {
      this.keepReleased(project, kept)
      this.deps.save(this.state)
    }
    this.kick()
  }

  private enters(project: string, task: Task, rules: ChainRules): boolean {
    if (isActive(rules, task.status)) return true
    return this.currentOf(project) === task.id && this.deps.busy(task.id)
  }

  start(project: string): void {
    this.requireProject(project)
    const { active, queue } = this.state
    if (this.chainOf(project) !== undefined || queue.includes(project)) return
    if (active.length < this.deps.parallel()) {
      this.requireLaunches()
      active.push(newChain(project))
    } else queue.push(project)
    this.changed()
  }

  resume(project: string): void {
    const chain = this.chainOf(project)
    if (chain === undefined) return
    this.requireLaunches()
    chain.paused = false
    chain.error = null
    this.changed()
  }

  stop(project: string): void {
    const chain = this.chainOf(project)
    if (chain === undefined) return
    this.letGo(chain)
    this.drop(chain)
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
    if (!(this.tasks.get(project) ?? []).some((open) => open.id === task)) throw fail('chain.notOpen', { task, project })
    const chain = this.chainOf(project)
    const holder = chain !== undefined && chain.current?.task === task ? chain : null
    if (holder?.current?.sessionId === null) throw fail('chain.launching', { task })
    if (holder !== null && this.deps.busy(task)) throw fail('chain.midTurn', { task })
    const skipped = (this.state.skipped[project] ??= [])
    if (!skipped.includes(task)) skipped.push(task)
    if (holder !== null) this.release(holder, 'skip', [])
    this.changed()
  }

  restart(project: string, task: string): void {
    this.requireProject(project)
    const chain = this.chainOf(project)
    const current = chain?.current?.task === task ? chain.current : null
    if (chain === undefined || current === null) throw fail('chain.notCurrent', { task })
    if (current.sessionId === null) throw fail('chain.launching', { task })
    if (this.deps.busy(task)) throw fail('chain.midTurn', { task })
    this.requireLaunches()
    const reset = this.deps.limitReset()
    if (reset !== null) throw fail('chain.limitSpent', { until: reset })
    const session = this.deps.handoff(task)
    if (session === undefined) throw fail('chain.noSession', { task })
    const replaced = current.sessionId
    this.work = this.work.then(() => this.replace(chain, current, replaced, session))
  }

  dismiss(project: string, task: string): void {
    const leftovers = this.state.leftovers[project]
    if (leftovers === undefined || !leftovers.some((each) => each.task === task)) return
    const kept = leftovers.filter((each) => each.task !== task)
    if (kept.length === 0) delete this.state.leftovers[project]
    else this.state.leftovers[project] = kept
    this.deps.save(this.state)
  }

  setUnattended(on: boolean): void {
    if (this.state.unattended === on) return
    this.state.unattended = on
    this.changed()
  }

  setTrimTools(on: boolean): void {
    if (this.state.trimTools === on) return
    this.state.trimTools = on
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
    if (!same) throw fail('chain.queueChanged', { queue: [...queue] })
    this.state.queue = [...order]
    this.changed()
  }

  reorder(project: string, order: string[]): void {
    this.requireProject(project)
    const tasks = this.tasks.get(project) ?? []
    checkOrder(tasks, order)
    const current = this.currentOf(project)
    if (current !== undefined && tasks.some((task) => task.id === current) && order[0] !== current) {
      throw fail('chain.currentFirst', { task: current })
    }
    this.state.orders[project] = [...order]
    this.changed()
  }

  orders(): Record<string, ProjectOrder> {
    const result: Record<string, ProjectOrder> = {}
    for (const [project, tasks] of this.tasks) {
      const waiting = this.waitingIds(project)
      const backlog = (this.backlog.get(project) ?? []).map((task) => task.id)
      const listed = this.outside.get(project) ?? []
      const outside = (this.waiting.get(project) ?? []).filter((task) => listed.includes(task))
      const extra = outside.length > 0 ? { outside } : {}
      try {
        const order = chainOrder(tasks, this.preferred(project))
        const landing = this.landing(project)
        result[project] = { order, waiting, ...extra, backlog, ...(Object.keys(landing).length > 0 ? { landing } : {}), error: null }
      } catch (error) {
        result[project] = { order: [], waiting, ...extra, backlog, error: noticeOf(error) }
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
    if (!this.deps.projects.includes(project)) throw fail('chain.unknownProject', { project })
  }

  private waitingIds(project: string): string[] {
    return (this.waiting.get(project) ?? []).map((task) => task.id)
  }

  private chainOf(project: string): ActiveChain | undefined {
    return this.state.active.find((chain) => chain.project === project)
  }

  private currentOf(project: string): string | undefined {
    return this.chainOf(project)?.current?.task
  }

  private drop(chain: ActiveChain): void {
    this.state.active = this.state.active.filter((each) => each !== chain)
  }

  /** Takes queued projects while fewer chains than `parallel` are active; a lowered `parallel` stops nothing that runs. */
  private fill(): void {
    let taken = false
    while (this.state.active.length < this.deps.parallel()) {
      const next = this.state.queue.shift()
      if (next === undefined) break
      this.state.active.push(newChain(next))
      taken = true
    }
    if (taken) this.deps.save(this.state)
  }

  private preferred(project: string, stored = this.state.orders[project]): string[] | undefined {
    const current = this.currentOf(project)
    if (stored === undefined || current === undefined) return stored
    return [current, ...stored.filter((id) => id !== current)]
  }

  private placeNew(project: string): boolean {
    const placed = this.placed(project, this.tasks.get(project) ?? [])
    if (placed === undefined) return false
    this.state.orders[project] = placed
    return true
  }

  /** The manual order with the chain's new tasks put in and the gone ones dropped; `undefined` — there is none or nothing changes. */
  private placed(project: string, tasks: Task[]): string[] | undefined {
    const stored = this.state.orders[project]
    if (stored === undefined) return undefined
    const open = new Set(tasks.map((task) => task.id))
    const kept = stored.filter((id) => open.has(id))
    const fresh = [...open].filter((id) => !stored.includes(id))
    if (fresh.length === 0 && kept.length === stored.length) return undefined

    const preferred = this.preferred(project, kept)!.filter((id) => open.has(id))
    const current = this.currentOf(project)
    const base = withFresh(tasks, preferred, fresh, current !== undefined && preferred[0] === current ? 1 : 0)
    try {
      return chainOrder(tasks, base)
    } catch {
      return base
    }
  }

  private landing(project: string): Record<string, string | null> {
    const rules = this.deps.rules(project)
    const chain = this.tasks.get(project) ?? []
    const result: Record<string, string | null> = {}
    for (const task of this.backlog.get(project) ?? []) {
      if (!admits(rules, task)) continue
      const tasks = [...chain, task]
      try {
        const order = chainOrder(tasks, this.preferred(project, this.placed(project, tasks) ?? this.state.orders[project]))
        result[task.id] = order[order.indexOf(task.id) + 1] ?? null
      } catch {
        continue
      }
    }
    return result
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
    this.letGo(chain)
  }

  private letGo(chain: ActiveChain): void {
    if (chain.current === null) return
    const released = (this.state.released[chain.project] ??= [])
    if (!released.includes(chain.current.task)) released.push(chain.current.task)
    chain.current = null
  }

  private take(chain: ActiveChain, current: CurrentTask): void {
    chain.current = current
    const released = this.released(chain.project)
    if (released.includes(current.task)) this.keepReleased(chain.project, released.filter((id) => id !== current.task))
  }

  private keepReleased(project: string, released: string[]): void {
    if (released.length === 0) delete this.state.released[project]
    else this.state.released[project] = released
    const done = this.releasedDone.get(project)
    for (const id of done ?? []) if (!released.includes(id)) done!.delete(id)
  }

  private keepOutcome(project: string, task: string, outcome: FinishOutcome): void {
    const sync = outcome.syncError === null ? [] : [notice('cleanup.syncFailed', {}, { cause: outcome.syncError })]
    const warnings = [...outcome.warnings, ...sync]
    if (warnings.length === 0) return
    const at = this.deps.now().toISOString()
    const leftovers = (this.state.leftovers[project] ??= [])
    leftovers.push(...warnings.map((notice) => ({ task, at, notice })))
  }

  private async sweep(): Promise<void> {
    for (const [project, done] of this.releasedDone) {
      for (const task of done) {
        if (this.deps.busy(task)) continue
        this.keepOutcome(project, task, await this.cleanUp(project, task))
        this.keepReleased(project, this.released(project).filter((id) => id !== task))
        this.deps.save(this.state)
      }
    }
  }

  private async cleanUp(project: string, task: string): Promise<FinishOutcome> {
    try {
      return await this.deps.finish(project, task)
    } catch (error) {
      return { warnings: [notice('cleanup.failed', {}, { cause: noticeOf(error) })], syncError: null }
    }
  }

  private requireLaunches(): void {
    const reason = this.deps.blocked()
    if (reason !== undefined) throw new NoticeError(reason)
  }

  private changed(): void {
    this.deps.save(this.state)
    this.kick()
  }

  private kick(): void {
    this.work = this.work.then(() => this.advance())
  }

  private async advance(): Promise<void> {
    await this.sweep()
    const seen = new Set<ActiveChain>()
    for (;;) {
      this.fill()
      const chain = this.state.active.find((each) => !seen.has(each))
      if (chain === undefined) return
      seen.add(chain)
      await this.step(chain)
    }
  }

  private async step(chain: ActiveChain): Promise<void> {
    for (;;) {
      if (chain.paused) return
      const tasks = this.tasks.get(chain.project)
      if (tasks === undefined) return
      if (chain.closing !== undefined && !(await this.finish(chain, chain.closing))) return

      if (chain.current !== null) {
        const { task, sessionId } = chain.current
        if (sessionId === null) {
          this.halt(chain, notice('chain.interrupted', { task }))
          return
        }
        if (!tasks.some((open) => open.id === task)) {
          if (this.done.get(chain.project)?.has(task)) {
            chain.current = null
            chain.closing = task
            this.deps.save(this.state)
            continue
          }
          this.letGo(chain)
          this.deps.save(this.state)
        } else {
          const blockers = openBlockers([...tasks, ...(this.waiting.get(chain.project) ?? [])], task)
          if (blockers.length > 0 && !this.deps.busy(task)) {
            this.release(chain, 'postpone', blockers)
          } else if (this.unanswered(chain.current)) {
            const skipped = (this.state.skipped[chain.project] ??= [])
            if (!skipped.includes(task)) skipped.push(task)
            this.release(chain, 'skip', [])
          } else {
            if (!(await this.followLimit(chain, chain.current))) await this.followCheckpoint(chain, chain.current)
            return
          }
          this.deps.save(this.state)
        }
      }

      let order: string[]
      try {
        order = chainOrder(tasks, this.state.orders[chain.project])
      } catch (error) {
        this.halt(chain, noticeOf(error))
        return
      }

      const task = nextTask(tasks, order, [...(this.state.skipped[chain.project] ?? []), ...this.waitingIds(chain.project)])
      if (task === undefined) {
        this.drop(chain)
        this.deps.save(this.state)
        return
      }

      const since = this.deps.now().toISOString()
      const live = this.deps.liveSession(task)
      if (live !== undefined) {
        delete chain.limitUntil
        this.take(chain, { task, sessionId: live, since })
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
      const current: CurrentTask = { task, sessionId: null, since, starting: since }
      this.take(chain, current)
      this.deps.save(this.state)
      try {
        const sessionId = await this.deps.launch(chain.project, task)
        this.deps.journal({ at: since, project: chain.project, task, sessionId })
        current.sessionId = sessionId
        delete current.starting
        this.deps.save(this.state)
      } catch (error) {
        this.halt(chain, noticeOf(error))
      }
      return
    }
  }

  private async finish(chain: ActiveChain, task: string): Promise<boolean> {
    if (!this.done.get(chain.project)?.has(task)) {
      delete chain.closing
      this.deps.save(this.state)
      return true
    }
    if (this.deps.busy(task)) {
      if (!this.quietTooLong(task)) return false
      delete chain.closing
      const released = (this.state.released[chain.project] ??= [])
      if (!released.includes(task)) released.push(task)
      this.deps.save(this.state)
      return true
    }
    const outcome = await this.cleanUp(chain.project, task)
    delete chain.closing
    this.keepOutcome(chain.project, task, outcome)
    this.deps.save(this.state)
    return true
  }

  private async followLimit(chain: ActiveChain, current: CurrentTask): Promise<boolean> {
    const session = this.deps.limited(current.task)
    if (session === undefined) {
      if (current.limit !== undefined && current.limit.acted === null) {
        delete current.limit
        this.deps.save(this.state)
      }
      return false
    }
    if (current.limit?.at !== session.limit.at) {
      if (this.deps.account().id === null) return true
      current.limit = holdOf(session, this.deps.accountAt(session.account, session.limit.at), this.deps.limitReset())
      this.deps.save(this.state)
    }
    const hold = current.limit
    const now = this.deps.now()
    const step = relayStep(hold, now, this.deps.account())
    if (step === 'wait') return true

    hold.acted = step
    current.starting = now.toISOString()
    this.deps.save(this.state)
    try {
      const sessionId = step === 'resume' ? await this.deps.resume(current.task, session) : await this.handOver(current.task, session, 'limit')
      this.deps.journal({
        at: now.toISOString(),
        project: chain.project,
        task: current.task,
        sessionId,
        reason: step,
        previous: session.sessionId,
      })
      current.sessionId = sessionId
      current.resumedAt = now.toISOString()
      delete current.starting
      this.deps.save(this.state)
    } catch (error) {
      this.halt(chain, noticeOf(error))
    }
    return true
  }

  private unanswered(current: CurrentTask): boolean {
    if (!this.state.unattended || this.deps.midTurn(current.task) || this.deps.limited(current.task) !== undefined) return false
    const session = this.deps.handoff(current.task)
    if (session === undefined || session.sessionId !== current.sessionId || session.checkpoint !== null) return false
    const moments = [current.since, current.resumedAt, session.lastReplyAt].filter((at) => at != null)
    const quietSince = Math.max(...moments.map((at) => Date.parse(at)))
    return this.deps.now().getTime() - quietSince >= UNANSWERED_MS
  }

  /** Unattended, the chain does not wait past ten quiet minutes for a session of a done task; the sweep cleans up after it. */
  private quietTooLong(task: string): boolean {
    const lastReplyAt = this.deps.handoff(task)?.lastReplyAt
    if (!this.state.unattended || lastReplyAt == null) return false
    return this.deps.now().getTime() - Date.parse(lastReplyAt) >= UNANSWERED_MS
  }

  private async followCheckpoint(chain: ActiveChain, current: CurrentTask): Promise<void> {
    if (this.deps.busy(current.task)) return
    const session = this.deps.handoff(current.task)
    if (session === undefined || session.checkpoint === null || session.sessionId !== current.sessionId) return
    if (this.deps.blocked() !== undefined || this.deps.limitReset() !== null) return
    await this.handOverCurrent(chain, current, session, 'checkpoint')
  }

  private async replace(chain: ActiveChain, current: CurrentTask, replaced: string, session: HandoffSession): Promise<void> {
    if (!this.state.active.includes(chain) || chain.current !== current || current.sessionId !== replaced) return
    await this.handOverCurrent(chain, current, session, 'restart')
  }

  private async handOverCurrent(
    chain: ActiveChain,
    current: CurrentTask,
    session: HandoffSession,
    reason: 'restart' | 'checkpoint',
  ): Promise<void> {
    const at = this.deps.now().toISOString()
    delete current.limit
    current.starting = at
    this.deps.save(this.state)
    try {
      const sessionId = await this.handOver(current.task, session, reason)
      this.deps.journal({ at, project: chain.project, task: current.task, sessionId, reason, previous: session.sessionId })
      current.sessionId = sessionId
      delete current.starting
      this.deps.save(this.state)
    } catch (error) {
      this.halt(chain, noticeOf(error))
    }
  }

  private async handOver(task: string, session: HandoffSession, reason: HandoffReason): Promise<string> {
    const located = await this.deps.locate(session)
    return this.deps.relay(task, located, handoffPrompt(task, located, reason, this.deps.promptLanguage()))
  }

  private halt(chain: ActiveChain, error: Notice): void {
    this.letGo(chain)
    chain.paused = true
    chain.error = error
    delete chain.limitUntil
    this.deps.save(this.state)
  }
}
