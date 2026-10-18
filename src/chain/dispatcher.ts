import type { FinishOutcome } from '../git/types.js'
import { englishOf, fail, notice, NoticeError, noticeOf, sameNotice, type Notice } from '../notice/notice.js'
import { renameChainProjects } from '../storage/projects.js'
import { isOpen, type Task } from '../tracker/model.js'
import {
  newChain,
  type ActiveChain,
  type ChainState,
  type CurrentTask,
  type DispatcherDeps,
  type LaunchEntry,
  type MainPush,
  type ProjectOrder,
  type ReleaseReason,
} from './model.js'
import { isFixName } from './fix.js'
import { Handovers } from './handover.js'
import { MainCheck } from './maincheck.js'
import { MainFix } from './mainfix.js'
import type { ChainView } from './milestones.js'
import { byNumber, chainOrder, checkOrder, nextTask, openBlockers, waitingBlockers, withFresh } from './order.js'
import { admits, excludes, isActive, isDone, isTerminal, type ChainRules } from './rules.js'
import type { HandoffSession } from './relay.js'

export {
  emptyChainState,
  type ActiveChain,
  type ChainState,
  type CurrentTask,
  type DispatcherDeps,
  type LaunchEntry,
  type Leftover,
  type ProjectOrder,
  type ReleaseReason,
} from './model.js'

const SLOT_RETRY_MS = 30_000
const SLOT_REFUSALS = new Set(['slot.noneFree', 'slot.busyStart'])

export class Dispatcher {
  private readonly tasks = new Map<string, Task[]>()
  private readonly waiting = new Map<string, Task[]>()
  private readonly outside = new Map<string, Task[]>()
  private readonly backlog = new Map<string, Task[]>()
  private readonly done = new Map<string, Set<string>>()
  private readonly releasedDone = new Map<string, Set<string>>()
  private work: Promise<void> = Promise.resolve()
  private readonly main: MainCheck | null
  private readonly fixes: MainFix | null
  private readonly handovers: Handovers

  constructor(
    readonly state: ChainState,
    private readonly deps: DispatcherDeps,
  ) {
    this.handovers = new Handovers(state, deps, (chain, error) => this.halt(chain, error))
    this.main =
      deps.main === undefined ? null : new MainCheck(state, deps.main, deps.now, deps.log, { save: () => deps.save(state), wake: () => this.changed() })
    this.fixes =
      this.main === null
        ? null
        : new MainFix(state, deps, this.main, {
            halt: (chain, error) => this.halt(chain, error),
            letGo: (chain) => this.letGo(chain),
            take: (chain, current) => this.take(chain, current),
            release: (project, task) => this.remember(project, task),
            closeUp: (project, task) => this.closeUp(project, task),
            handOver: (task, session, reason, extra) => this.handovers.handOver(task, session, reason, extra),
            heldByMain: (chain, task) => this.heldByMain(chain, task, (this.tasks.get(chain.project) ?? []).map((open) => open.id), false),
          })
  }

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
    const holds = current?.sessionId && !isFixName(current.task) ? [current.task] : []
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

  /**
   * Starts or queues the project's chain. With nothing to run by the last task list, it reads the tracker anew
   * first — a task created a moment ago is not in the list yet — and refuses if there is still nothing.
   */
  async start(project: string): Promise<void> {
    this.requireProject(project)
    if (this.going(project)) return
    if (!this.hasWork(project)) {
      await this.deps.refresh(project)
      if (this.going(project)) return
      const empty = this.emptyReason(project)
      if (empty !== undefined) {
        this.deps.log(englishOf(empty))
        throw new NoticeError(empty)
      }
    }
    const { active, queue } = this.state
    if (active.length < this.deps.parallel()) {
      this.requireLaunches(project)
      active.push(newChain(project))
    } else queue.push(project)
    this.changed()
  }

  resume(project: string): void {
    const chain = this.chainOf(project)
    if (chain === undefined) return
    this.requireLaunches(project)
    chain.paused = false
    chain.error = null
    this.changed()
  }

  stop(project: string): void {
    const chain = this.chainOf(project)
    if (chain === undefined) return
    this.letGo(chain)
    if (chain.interrupted !== undefined) this.remember(project, chain.interrupted.task)
    this.drop(chain)
    this.changed()
  }

  dequeue(project: string): void {
    const index = this.state.queue.indexOf(project)
    if (index < 0) return
    this.state.queue.splice(index, 1)
    this.changed()
  }

  /**
   * The project left the config: its chain stops and leaves the queue as with Stop, its sessions are not touched
   * (invariant 1); the order, skips and leftovers it had stay saved for its return.
   */
  forget(project: string): void {
    this.stop(project)
    this.dequeue(project)
    for (const map of this.byProject()) map.delete(project)
  }

  /** Project keys renamed in the config: the chain state and the tasks read follow the new keys. */
  rekey(rename: (project: string) => string): void {
    Object.assign(this.state, renameChainProjects(this.state as unknown as Record<string, unknown>, rename))
    for (const map of this.byProject()) {
      const entries = [...map.entries()]
      map.clear()
      for (const [project, value] of entries) (map as Map<string, unknown>).set(rename(project), value)
    }
    this.changed()
  }

  private byProject(): Map<string, unknown>[] {
    return [this.tasks, this.waiting, this.outside, this.backlog, this.done, this.releasedDone]
  }

  skip(project: string, task: string): void {
    this.requireProject(project)
    if (this.fixes !== null && isFixName(task)) {
      this.fixes.skip(this.chainOf(project), task)
      this.changed()
      return
    }
    if (!(this.tasks.get(project) ?? []).some((open) => open.id === task)) throw fail('chain.notOpen', { task, project })
    const chain = this.chainOf(project)
    const holder = chain !== undefined && chain.current?.task === task ? chain : null
    if (holder?.current?.sessionId === null) throw fail('chain.launching', { task })
    if (this.deps.busy(task)) throw fail('chain.midTurn', { task })
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
    this.requireLaunches(project, task)
    const reset = this.deps.limitReset(project, task)
    if (reset !== null) throw fail('chain.limitSpent', { until: reset })
    const session = this.deps.handoff(task)
    if (session === undefined) throw fail('chain.noSession', { task })
    const replaced = current.sessionId
    this.work = this.work.then(() => this.handovers.replace(chain, current, replaced, session))
  }

  /**
   * Throws unless the user may answer the session now: it is the current one of the task — of its chain or, once
   * the chain stopped, the one that lives on — waits rather than works, and still waits on the question `ask`
   * (`null` — on none, the turn ended in plain text).
   */
  answerable(
    project: string,
    task: string,
    sessionId: string,
    ask: string | null,
  ): { chain: ActiveChain | null; current: CurrentTask | null; session: HandoffSession } {
    this.requireProject(project)
    const chain = this.chainOf(project) ?? null
    const current = chain?.current?.task === task ? chain.current : null
    if (chain !== null && current === null) throw fail('chain.notCurrent', { task })
    if (current !== null && (current.sessionId === null || current.starting !== undefined)) throw fail('chain.launching', { task })
    const session = this.deps.handoff(task)
    if ((current !== null && current.sessionId !== sessionId) || session?.sessionId !== sessionId || this.deps.asked(task) !== ask) {
      throw fail('answer.moved', { task })
    }
    if (this.deps.midTurn(task)) throw fail('answer.busy', { task })
    this.requireLaunches(project, task)
    const reset = this.deps.limitReset(project, task)
    if (reset !== null) throw fail('chain.limitSpent', { until: reset })
    return { chain, current, session }
  }

  /** Invariant 1, exception 6: the user's own answer resumes the session that waits for it. */
  answer(project: string, task: string, sessionId: string, ask: string | null, prompt: string): void {
    const { chain, current, session } = this.answerable(project, task, sessionId, ask)
    this.work = this.work.then(() =>
      chain === null || current === null ? this.handovers.deliverLoose(project, task, session, prompt) : this.handovers.deliver(chain, current, session, prompt, ask),
    )
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
        const { landing, refused } = this.landing(project)
        result[project] = {
          order,
          waiting,
          ...extra,
          backlog,
          ...(Object.keys(landing).length > 0 ? { landing } : {}),
          ...(Object.keys(refused).length > 0 ? { refused } : {}),
          error: null,
        }
      } catch (error) {
        result[project] = { order: [], waiting, ...extra, backlog, error: noticeOf(error) }
      }
    }
    return result
  }

  view(project: string): ChainView {
    const listed = this.outside.get(project) ?? []
    return {
      tasks: this.tasks.get(project) ?? [],
      blockers: (this.waiting.get(project) ?? []).filter((task) => !listed.includes(task)),
      current: this.currentOf(project),
    }
  }

  check(): void {
    this.kick()
  }

  idle(): Promise<void> {
    return this.work
  }

  private requireProject(project: string): void {
    if (!this.deps.projects().includes(project)) throw fail('chain.unknownProject', { project })
  }

  /** The project's chain runs or is queued already; a chain started only for the fix of a red main now goes on with the tasks. */
  private going(project: string): boolean {
    const chain = this.chainOf(project)
    if (chain === undefined && !this.state.queue.includes(project)) return false
    if (chain?.fixOnly) {
      delete chain.fixOnly
      this.changed()
    }
    return true
  }

  private hasWork(project: string): boolean {
    const tasks = this.tasks.get(project)
    if (tasks === undefined) return false
    if (this.main?.sessionFix(project) !== undefined) return true
    try {
      return this.nextOf(project, tasks) !== undefined
    } catch {
      // A broken order halts the chain, which shows why.
      return true
    }
  }

  /** Why the project's chain has nothing to run; `undefined` — it has. */
  private emptyReason(project: string): Notice | undefined {
    if (this.hasWork(project)) return undefined
    const tasks = this.tasks.get(project)
    if (tasks === undefined) return notice('chain.notRead', { project })
    return notice('chain.empty', { project }, { cause: this.whyEmpty(project, tasks) })
  }

  private whyEmpty(project: string, tasks: Task[]): Notice {
    const skipped = this.state.skipped[project] ?? []
    if (tasks.length > 0) return tasks.every((task) => skipped.includes(task.id)) ? notice('chain.emptySkipped', {}) : notice('chain.emptyBlocked', {})
    const rules = this.deps.rules(project)
    const backlog = this.backlog.get(project) ?? []
    if (backlog.some((task) => isActive(rules, task.status))) return notice('chain.emptyLabels', { labels: rules.requiredLabels })
    return backlog.length > 0 ? notice('chain.emptyStatus', {}) : notice('chain.emptyNone', {})
  }

  /** The task the chain takes next by its list, the fix of a red main first; `undefined` — none. Throws on a broken order. */
  private nextOf(project: string, tasks: Task[]): string | undefined {
    const order = chainOrder(tasks, this.state.orders[project])
    const skipped = this.state.skipped[project] ?? []
    const fixTask = this.main?.fixOf(project, tasks.map((open) => open.id).filter((id) => !skipped.includes(id)))
    return fixTask ?? nextTask(tasks, order, [...skipped, ...this.waitingIds(project)])
  }

  private waitingIds(project: string): string[] {
    return (this.waiting.get(project) ?? []).map((task) => task.id)
  }

  private chainOf(project: string): ActiveChain | undefined {
    return this.state.active.find((chain) => chain.project === project)
  }

  /** The task the chain leads; while a fix session of main runs — the task it interrupted, if any. */
  private currentOf(project: string): string | undefined {
    const chain = this.chainOf(project)
    const task = chain?.current?.task
    return task === undefined || isFixName(task) ? chain?.interrupted?.task : task
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

  /** Called only once the chain's own order builds, so a refusal is the task's doing. */
  private landing(project: string): Pick<Required<ProjectOrder>, 'landing' | 'refused'> {
    const rules = this.deps.rules(project)
    const chain = this.tasks.get(project) ?? []
    const outside = this.outside.get(project) ?? []
    const blockers = (this.waiting.get(project) ?? []).filter((task) => !outside.some((each) => each.id === task.id))
    const landing: Record<string, string | null> = {}
    const refused: Record<string, Notice> = {}
    for (const task of [...(this.backlog.get(project) ?? []), ...blockers]) {
      if (!admits(rules, task)) continue
      const tasks = [...chain, task]
      try {
        const order = chainOrder(tasks, this.preferred(project, this.placed(project, tasks) ?? this.state.orders[project]))
        landing[task.id] = order[order.indexOf(task.id) + 1] ?? null
      } catch (error) {
        refused[task.id] = noticeOf(error)
      }
    }
    return { landing, refused }
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
    if (!isFixName(chain.current.task)) this.remember(chain.project, chain.current.task)
    chain.current = null
  }

  private remember(project: string, task: string): void {
    const released = (this.state.released[project] ??= [])
    if (!released.includes(task)) released.push(task)
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
        await this.closeUp(project, task)
        this.keepReleased(project, this.released(project).filter((id) => id !== task))
        this.deps.save(this.state)
      }
    }
  }

  /** Cleans up after a done task and, once main is pushed, awaits the CI's verdict on it. */
  private async closeUp(project: string, task: string): Promise<void> {
    const tree = (await this.main?.taskTree(project, task)) ?? null
    const outcome = await this.cleanUp(project, task)
    this.keepOutcome(project, task, outcome)
    if (outcome.syncError === null) await this.main?.pushed(project, task, tree)
  }

  /** Whether the task is open in the tracker, in the chain or out of it. */
  private readonly listedOpen = (project: string, task: string): boolean =>
    [...(this.tasks.get(project) ?? []), ...(this.waiting.get(project) ?? []), ...(this.backlog.get(project) ?? [])].some((each) => each.id === task)

  private async settleMain(): Promise<void> {
    if (this.main === null) return
    const { changed, stops, fixes } = await this.main.settle(this.listedOpen)
    for (const { project, notice } of stops) {
      let chain = this.chainOf(project)
      if (chain === undefined) {
        this.state.queue = this.state.queue.filter((key) => key !== project)
        chain = newChain(project)
        this.state.active.push(chain)
      }
      this.halt(chain, notice)
      this.fixes!.giveBack(chain)
    }
    for (const project of fixes) {
      if (this.chainOf(project) === undefined && !this.state.queue.includes(project)) this.state.active.push({ ...newChain(project), fixOnly: true })
    }
    if (changed) this.deps.save(this.state)
  }

  /**
   * Whether the launch of `task` waits for the CI's verdict on main or for the project's `commands.afterGreen`;
   * with `ahead` the task's place is prepared meanwhile.
   */
  private heldByMain(chain: ActiveChain, task: string, listed: string[], ahead = true): boolean {
    const after = this.main?.afterGreenRun(chain.project)
    const hold = this.main?.holds(chain.project, listed) ?? null
    const wait: ActiveChain['ciWait'] =
      after !== undefined ? { ...after, after: true } : hold === null || hold === 'fix' ? undefined : { commit: hold.commit, since: hold.at }
    if (chain.ciWait?.commit !== wait?.commit || chain.ciWait?.after !== wait?.after) {
      if (wait === undefined) delete chain.ciWait
      else chain.ciWait = wait
      this.deps.save(this.state)
    }
    if (wait !== undefined && ahead) this.main!.ahead(chain.project, task)
    return after !== undefined || hold !== null
  }

  /** Runs the project's check on a push of main no CI judged, in the place of `task`; false — the chain is stopped. */
  private async checkMain(chain: ActiveChain, task: string, push: MainPush): Promise<boolean> {
    chain.ciWait = { commit: push.commit, since: this.deps.now().toISOString(), local: true }
    this.deps.save(this.state)
    const stop = await this.main!.checkLocally(chain.project, task, this.listedOpen)
    delete chain.ciWait
    this.deps.save(this.state)
    if (stop === null) return true
    this.halt(chain, stop)
    return false
  }

  private async cleanUp(project: string, task: string): Promise<FinishOutcome> {
    try {
      return await this.deps.finish(project, task)
    } catch (error) {
      return { warnings: [notice('cleanup.failed', {}, { cause: noticeOf(error) })], syncError: null }
    }
  }

  private requireLaunches(project: string, task?: string): void {
    const reason = this.deps.blocked(project, task)
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
    await this.settleMain()
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
        if (isFixName(task)) {
          if (this.fixes === null) chain.current = null
          else if (!(await this.fixes.follow(chain, chain.current))) {
            await this.handovers.follow(chain, chain.current)
            return
          }
          continue
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
          } else if (this.handovers.unanswered(chain.current)) {
            const skipped = (this.state.skipped[chain.project] ??= [])
            if (!skipped.includes(task)) skipped.push(task)
            this.release(chain, 'skip', [])
          } else if (this.fixes === null || !(await this.fixes.yields(chain, chain.current))) {
            await this.handovers.follow(chain, chain.current)
            return
          }
          this.deps.save(this.state)
          if (chain.paused) return
        }
      }

      const fix = this.main?.sessionFix(chain.project)
      if (fix === undefined && chain.fixOnly) {
        this.drop(chain)
        this.deps.save(this.state)
        return
      }
      if (fix === undefined && chain.interrupted !== undefined) {
        if (await this.fixes!.resume(chain, tasks)) continue
        return
      }

      let next: string | undefined
      try {
        next = this.nextOf(chain.project, tasks)
      } catch (error) {
        this.halt(chain, noticeOf(error))
        return
      }

      const listed = tasks.map((open) => open.id)
      const task = fix?.task ?? next
      if (task === undefined) {
        this.deps.log(`chain: ${chain.project} ended, no task left to run`)
        this.drop(chain)
        this.deps.save(this.state)
        return
      }

      const since = this.deps.now().toISOString()
      const live = this.deps.liveSession(task)
      if (live !== undefined) {
        delete chain.limitUntil
        delete chain.slotWait
        delete chain.ciWait
        this.take(chain, { task, sessionId: live, since })
        this.deps.save(this.state)
        return
      }

      if (fix === undefined && this.heldByMain(chain, task, listed)) return

      const blocked = this.deps.blocked(chain.project, task)
      if (blocked !== undefined) {
        this.halt(chain, blocked)
        return
      }

      const reset = this.deps.limitReset(chain.project, task)
      if (reset !== null) {
        if (chain.limitUntil !== reset) {
          chain.limitUntil = reset
          this.deps.save(this.state)
        }
        return
      }

      // A session would start without some of its tools; the page shows why (`packages` in the state).
      if (fix === undefined && this.deps.packagesBlocked(chain.project)) return

      const lastTry = chain.slotWait === undefined ? undefined : Date.parse(chain.slotWait.at)
      if (lastTry !== undefined && this.deps.now().getTime() - lastTry < SLOT_RETRY_MS) return

      const unjudged = fix === undefined ? this.main?.due(chain.project) : undefined
      if (unjudged !== undefined) {
        if (!(await this.checkMain(chain, task, unjudged))) return
        continue
      }

      delete chain.limitUntil
      const current: CurrentTask = { task, sessionId: null, since, starting: since }
      this.take(chain, current)
      this.deps.save(this.state)
      try {
        const { sessionId, fallback } = fix === undefined ? await this.deps.launch(chain.project, task) : { sessionId: await this.deps.launchFix(chain.project, task, fix.report) }
        this.deps.journal({ at: since, project: chain.project, task, sessionId, ...(fix !== undefined && { commit: fix.commit }), ...(fallback !== undefined && { fallback }) })
        current.sessionId = sessionId
        delete current.starting
        delete chain.slotWait
        this.deps.save(this.state)
      } catch (error) {
        const failure = noticeOf(error)
        if (this.state.unattended && SLOT_REFUSALS.has(failure.code)) this.waitForSlot(chain, task, failure)
        else this.halt(chain, failure)
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
      if (!this.handovers.quietTooLong(task)) return false
      delete chain.closing
      const released = (this.state.released[chain.project] ??= [])
      if (!released.includes(task)) released.push(task)
      this.deps.save(this.state)
      return true
    }
    await this.closeUp(chain.project, task)
    delete chain.closing
    this.deps.save(this.state)
    return true
  }

  private halt(chain: ActiveChain, error: Notice): void {
    this.letGo(chain)
    chain.paused = true
    chain.error = error
    delete chain.limitUntil
    delete chain.slotWait
    delete chain.ciWait
    this.deps.log(`chain: ${chain.project} paused: ${englishOf(error)}`)
    this.deps.save(this.state)
  }

  /** The task never started, so it is not released: the chain picks it again once a slot frees up. */
  private waitForSlot(chain: ActiveChain, task: string, refusal: Notice): void {
    chain.current = null
    const waiting = notice('slot.waiting', { task }, { items: refusal.items ?? [refusal] })
    if (!sameNotice(chain.slotWait?.notice ?? null, waiting)) this.deps.log(`chain: ${chain.project}: ${englishOf(waiting)}`)
    chain.slotWait = { notice: waiting, at: this.deps.now().toISOString() }
    this.deps.save(this.state)
  }
}
