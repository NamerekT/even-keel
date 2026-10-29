import { englishOf, fail, notice, NoticeError, noticeOf, type Notice } from '../notice/notice.js'
import { type Task } from '../tracker/model.js'
import {
  newChain,
  type ActiveChain,
  type CarrySession,
  type ChainState,
  type CurrentTask,
  type DispatcherDeps,
  type LaunchEntry,
  type ProjectOrder,
  type ReleaseReason,
} from './model.js'
import { Cleanups } from './cleanup.js'
import { answerable } from './answers.js'
import { MainCarry } from './carry.js'
import { isCarryName, isFixName, isOwnName } from './fix.js'
import { Handovers } from './handover.js'
import { TaskLists } from './lists.js'
import { MainCheck } from './maincheck.js'
import { MainFix } from './mainfix.js'
import { MainWait } from './mainwait.js'
import { Reviews } from './reviews.js'
import { returned as returnedSession, shelve } from './shelved.js'
import { Unchanged } from './unchanged.js'
import type { ChainView } from './milestones.js'
import { byNumber, chainOrder, checkOrder, nextTask, openBlockers, startsAhead } from './order.js'
import { excludes, isDone, isTerminal } from './rules.js'
import type { HandoffSession } from './relay.js'
import type { SilentRestart } from '../sessions/silence.js'
import { guardRestart } from './restartGuard.js'
import { requireLimit } from './limitNotice.js'
import { startTask } from './start.js'
import { OverageStops } from './overage.js'

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
  type ReviewView,
} from './model.js'

const SLOT_RETRY_MS = 30_000

export class Dispatcher {
  private work: Promise<void> = Promise.resolve()
  private readonly main: MainCheck | null
  private readonly fixes: MainFix | null
  private readonly carries: MainCarry
  private readonly handovers: Handovers
  private readonly reviews: Reviews
  private readonly unchanged: Unchanged
  private readonly lists: TaskLists
  private readonly cleanups: Cleanups
  private readonly waits: MainWait
  private readonly overage: OverageStops

  constructor(
    readonly state: ChainState,
    private readonly deps: DispatcherDeps,
  ) {
    this.handovers = new Handovers(state, deps, (chain, error) => this.halt(chain, error, error.code === 'chain.modelUnavailable'))
    this.overage = new OverageStops(state, deps, (chain, error) => this.halt(chain, error))
    this.reviews = new Reviews(state, deps, this.handovers, {
      hold: (chain, error) => this.halt(chain, error, true),
      letGo: (chain) => this.letGo(chain),
      release: (project, task) => this.remember(project, task),
      refilter: (project) => this.refilter(project),
      working: (task) => this.cleanups.working(task),
      dropUnmerged: (project, task, pull) => this.cleanups.dropUnmerged(project, task, pull),
    })
    this.unchanged = new Unchanged(deps, this.handovers, (chain, error) => this.halt(chain, error, true))
    this.lists = new TaskLists(state, deps, this.reviews, (project) => this.currentOf(project))
    this.main =
      deps.main === undefined ? null : new MainCheck(state, deps.main, deps.now, deps.log, { save: () => deps.save(state), wake: () => this.changed() })
    this.cleanups = new Cleanups(state, deps, this.main, this.reviews)
    this.fixes =
      this.main === null
        ? null
        : new MainFix(state, deps, this.main, {
            halt: (chain, error) => this.halt(chain, error),
            letGo: (chain) => this.letGo(chain),
            take: (chain, current) => this.take(chain, current),
            release: (project, task) => this.remember(project, task),
            closeUp: (project, task) => this.cleanups.closeUp(project, task),
            handOver: (task, session, reason, extra) => this.handovers.handOver(task, session, reason, extra),
            heldByMain: (chain, task) => this.waits.heldByMain(chain, task, (this.lists.tasks.get(chain.project) ?? []).map((open) => open.id), false),
          })
    this.carries = new MainCarry(state, deps, { closeUp: (project, task) => this.cleanups.closeUp(project, task) })
    this.waits = new MainWait(state, deps, this.main, this.lists, {
      chainOf: (project) => this.chainOf(project),
      halt: (chain, error) => this.halt(chain, error),
      giveBack: (chain) => this.fixes!.giveBack(chain),
    })
  }

  setTasks(project: string, tasks: Task[]): void {
    this.lists.listed.set(project, tasks)
    const rules = (task: Task) => this.deps.rules(project, task.id)
    const { chain, waiting } = this.lists.sorted(project, tasks)
    const backlog = tasks.filter(
      (task) => !excludes(rules(task), task) && !chain.includes(task) && !waiting.includes(task) && !this.reviews.holds(project, task.id),
    )
    this.lists.tasks.set(project, chain)
    this.lists.waiting.set(project, waiting)
    this.lists.backlog.set(project, backlog.sort((a, b) => byNumber(a.id, b.id)))
    this.lists.done.set(project, new Set(tasks.filter((task) => isDone(rules(task), task.status)).map((task) => task.id)))
    const placed = this.lists.placeNew(project)
    if (this.forgetClosed(project) || placed) this.deps.save(this.state)
    this.kick()
  }

  /** Blockers of the project tasks that its task list lacks: open parents and tasks of other projects, whatever their status. */
  setOutside(project: string, tasks: Task[]): void {
    this.lists.outside.set(project, tasks)
  }

  released(project: string): string[] {
    return this.cleanups.released(project)
  }

  held(project: string): string[] {
    const current = this.chainOf(project)?.current
    const holds = current?.sessionId && !isOwnName(current.task) ? [current.task] : []
    return [...holds, ...this.released(project).filter((id) => !holds.includes(id))]
  }

  setReleased(project: string, tasks: Task[]): void {
    const rules = (id: string) => this.deps.rules(project, id)
    const statuses = new Map(tasks.map((task) => [task.id, task.status]))
    const kept = this.released(project).filter((id) => {
      const status = statuses.get(id)
      return status !== undefined && (isDone(rules(id), status) || !isTerminal(rules(id), status))
    })
    this.cleanups.done.set(project, new Set(kept.filter((id) => isDone(rules(id), statuses.get(id)!))))
    if (kept.length !== this.released(project).length) {
      this.cleanups.keepReleased(project, kept)
      this.deps.save(this.state)
    }
    this.kick()
  }

  private refilter(project: string): void {
    const tasks = this.lists.listed.get(project)
    if (tasks !== undefined) this.setTasks(project, tasks)
  }

  /** Polls the open pull requests of PR mode (BTN-205), every project's or only `project`'s, and applies what their forges say. */
  async pollReviews(project?: string): Promise<void> {
    const polled = await this.reviews.poll(project)
    if (polled.length === 0) return
    this.work = this.work.then(async () => {
      for (const touched of await this.reviews.apply(polled)) {
        this.refilter(touched)
        if (this.reviews.wakes(touched)) this.wake(touched)
      }
    })
    await this.work
  }

  /**
   * Feedback came on a pull request of a chain that ended by itself: the chain starts again as with Start (BTN-375).
   * One the user stopped stays stopped, a paused one paused; one whose launches are blocked waits for the user too.
   */
  private wake(project: string): void {
    if (!this.deps.projects().includes(project) || this.going(project)) return
    const reason = this.deps.blocked(project)
    if (reason !== undefined && reason.code !== 'review.notReady') {
      this.deps.log(`chain: ${project} does not start again on feedback: ${englishOf(reason)}`)
      return
    }
    this.deps.log(`chain: ${project} starts again: feedback came on a pull request of its tasks`)
    this.enqueue(project)
  }

  /**
   * Starts or queues the project's chain. With nothing to run by the last task list, it reads the tracker anew
   * first — a task created a moment ago is not in the list yet — and refuses if there is still nothing.
   */
  async start(project: string): Promise<void> {
    this.requireProject(project)
    const chain = this.chainOf(project)
    if (chain?.paused && chain.error?.code === 'review.notOpened') return this.resume(project)
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
    this.enqueue(project)
  }

  private enqueue(project: string): void {
    const { active, queue } = this.state
    if (active.length < this.deps.parallel()) {
      const chain = newChain(project)
      this.admit(chain)
      active.push(chain)
    } else queue.push(project)
    this.changed()
  }

  resume(project: string): void {
    const chain = this.chainOf(project)
    if (chain === undefined) return
    const retry = chain.paused && chain.error?.code === 'review.notOpened' ? chain.current?.task : undefined
    this.admit(chain)
    if (retry !== undefined) this.reviews.retry(retry)
    this.changed()
  }

  stop(project: string): void {
    this.reviews.stopped(project)
    const chain = this.chainOf(project)
    if (chain === undefined) return
    this.letGo(chain)
    if (chain.interrupted !== undefined) this.remember(project, chain.interrupted.task)
    this.drop(chain)
    this.changed()
  }

  stopAfter(project: string, on: boolean): void {
    const chain = this.chainOf(project)
    if (chain === undefined || (chain.stopAfter === true) === on) return
    if (on) chain.stopAfter = true
    else delete chain.stopAfter
    this.changed()
  }

  dequeue(project: string): void {
    const index = this.state.queue.indexOf(project)
    if (index < 0) return
    this.reviews.stopped(project)
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

  private byProject(): Map<string, unknown>[] {
    return [...this.lists.maps(), this.cleanups.done]
  }

  skip(project: string, task: string): void {
    this.requireProject(project)
    if (this.fixes !== null && isFixName(task)) {
      this.fixes.skip(this.chainOf(project), task)
      this.changed()
      return
    }
    if (isCarryName(task)) {
      this.carries.skip(this.chainOf(project), task)
      this.changed()
      return
    }
    if (!(this.lists.tasks.get(project) ?? []).some((open) => open.id === task)) throw fail('chain.notOpen', { task, project })
    const chain = this.chainOf(project)
    const holder = chain !== undefined && chain.current?.task === task ? chain : null
    if (holder?.current?.sessionId === null) throw fail('chain.launching', { task })
    if (this.deps.busy(task)) throw fail('chain.midTurn', { task })
    const skipped = (this.state.skipped[project] ??= [])
    if (!skipped.includes(task)) skipped.push(task)
    if (holder !== null) this.release(holder, 'skip', [])
    this.changed()
  }

  /**
   * "Resolve with the agent" (BTN-369): a session resolves the release project's held carry after the current task of
   * the project it merges into; a project without a chain gets one for the carry alone. A carry asked already stays.
   */
  carry(from: string, carry: CarrySession): void {
    this.requireProject(carry.into)
    if (!this.carries.ask(from, carry)) return
    if (this.chainOf(carry.into) === undefined && !this.state.queue.includes(carry.into)) this.state.active.push({ ...newChain(carry.into), fixOnly: true })
    this.changed()
  }

  /** The release project's carry a session resolves or is about to (BTN-369). */
  carrying(from: string): CarrySession | undefined {
    return this.carries.of(from)
  }

  restart(project: string, task: string, confirmed?: SilentRestart): void {
    this.requireProject(project)
    const chain = this.chainOf(project)
    const current = chain?.current?.task === task ? chain.current : null
    if (chain === undefined || current === null) throw fail('chain.notCurrent', { task })
    if (current.sessionId === null) throw fail('chain.launching', { task })
    guardRestart(this.deps, task, current.sessionId, confirmed)
    this.requireLaunches(project, task)
    requireLimit(this.deps, project, task)
    const session = this.deps.handoff(task)
    if (session === undefined) throw fail('chain.noSession', { task })
    const replaced = current.sessionId
    this.work = this.work.then(() => {
      try {
        guardRestart(this.deps, task, replaced, confirmed)
      } catch (error) {
        console.warn(englishOf(noticeOf(error)))
        return
      }
      this.unhold(chain)
      return this.handovers.replace(chain, current, replaced, session)
    })
  }

  /**
   * Throws unless the user may answer the session now: it is the current one of the task — of its chain or, once
   * the chain stopped, the one that lives on — waits rather than works, and still waits on the question `ask`
   * (`null` — on none, the turn ended in plain text). With `takes` — the session takes a message mid-turn, by its
   * mailbox (BTN-181) or straight in (BTN-291) — a plain message to a working session passes as `midTurn`: nothing is
   * launched.
   */
  answerable(
    project: string,
    task: string,
    sessionId: string,
    ask: string | null,
    takes = false,
  ): { chain: ActiveChain | null; current: CurrentTask | null; session: HandoffSession; midTurn: boolean } {
    return answerable(this.state, this.deps, project, task, sessionId, ask, takes)
  }

  /** Invariant 1, exception 6: queues the user's answer and resolves to whether it reached the session. */
  answer(project: string, task: string, sessionId: string, ask: string | null, prompt: string): Promise<boolean> {
    const { chain, current, session } = this.answerable(project, task, sessionId, ask)
    const delivery = this.work.then(() => {
      if (chain === null || current === null) return this.handovers.deliverLoose(project, task, session, prompt)
      this.unhold(chain)
      return this.handovers.deliver(chain, current, session, prompt, ask)
    })
    this.work = delivery.then(() => {})
    return delivery
  }

  /** A pause for the user to tell the session of a mark refused what to do ends once they do: its next mark opens at once. */
  private unhold(chain: ActiveChain): void {
    if (!chain.paused || chain.error?.code !== 'review.notOpened') return
    chain.paused = false
    chain.error = null
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
    const tasks = this.lists.tasks.get(project) ?? []
    checkOrder(tasks, order)
    const current = this.currentOf(project)
    const holding = [...(this.state.skipped[project] ?? []), ...this.lists.waitingIds(project)]
    if (current !== undefined && tasks.some((task) => task.id === current) && startsAhead(tasks, order, current, holding)) {
      throw fail('chain.currentFirst', { task: current })
    }
    this.state.orders[project] = [...order]
    this.changed()
  }

  orders(): Record<string, ProjectOrder> {
    return this.lists.orders()
  }

  view(project: string): ChainView {
    return this.lists.view(project)
  }

  /** The view `setTasks(project, tasks)` would give, the lists left as they are. */
  preview(project: string, tasks: Task[]): ChainView {
    const { chain, waiting } = this.lists.sorted(project, tasks)
    const outside = this.lists.outside.get(project) ?? []
    return { tasks: chain, blockers: waiting.filter((task) => !outside.includes(task)), current: this.currentOf(project) }
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
    const tasks = this.lists.tasks.get(project)
    if (tasks === undefined) return false
    if (this.main?.sessionFix(project) !== undefined || this.carries.due(project) !== undefined) return true
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
    const tasks = this.lists.tasks.get(project)
    if (tasks === undefined) return notice('chain.notRead', { project })
    return notice('chain.empty', { project }, { cause: this.lists.whyEmpty(project, tasks) })
  }

  /** The task the chain takes next by its list, the fix of a red main first; `undefined` — none. Throws on a broken order. */
  private nextOf(project: string, tasks: Task[]): string | undefined {
    const order = chainOrder(tasks, this.state.orders[project])
    const skipped = this.state.skipped[project] ?? []
    const open = tasks.map((task) => task.id).filter((id) => !skipped.includes(id))
    return this.main?.fixOf(project, open) ?? this.reviews.next(project, open) ?? nextTask(tasks, order, [...skipped, ...this.lists.waitingIds(project)])
  }

  private chainOf(project: string): ActiveChain | undefined {
    return this.state.active.find((chain) => chain.project === project)
  }

  /** The task the chain leads; while a fix session of main runs — the task it interrupted, if any. */
  private currentOf(project: string): string | undefined {
    const chain = this.chainOf(project)
    const task = chain?.current?.task
    return task === undefined || isOwnName(task) ? chain?.interrupted?.task : task
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

  private forgetClosed(project: string): boolean {
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

  private release(chain: ActiveChain, reason: ReleaseReason, blockers: string[]): void {
    shelve(this.state, this.deps, chain.project, chain.current!, reason, blockers)
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
    if (!isOwnName(chain.current.task)) this.remember(chain.project, chain.current.task)
    chain.current = null
  }

  private remember(project: string, task: string): void {
    const released = (this.state.released[project] ??= [])
    if (!released.includes(task)) released.push(task)
  }

  private take(chain: ActiveChain, current: CurrentTask): void {
    chain.current = current
    const released = this.released(chain.project)
    if (released.includes(current.task)) this.cleanups.keepReleased(chain.project, released.filter((id) => id !== current.task))
  }

  /** A pause because PR mode had nowhere to go ends by itself once it has: a remote or a token added (EKR-12). */
  private cleared(chain: ActiveChain): boolean {
    if (!['review.notReady', 'agent.copyMissing'].includes(chain.error?.code ?? '') || this.deps.blocked(chain.project, chain.current?.task ?? this.nextOf(chain.project, this.lists.tasks.get(chain.project) ?? [])) !== undefined) return false
    chain.paused = false
    chain.error = null
    this.deps.log(`chain: ${chain.project} goes on: its launch requirement is ready`)
    this.deps.save(this.state)
    return true
  }

  /**
   * Start and Resume refuse while launches are blocked, except by PR mode with nowhere to go: then the chain waits
   * paused on `review.notReady`, which `cleared` lifts by itself (BTN-316). Unsupported OpenCode Copilot also admits
   * a paused chain, but requires an explicit resume after the model or account is changed.
   */
  private admit(chain: ActiveChain): void {
    const reason = this.deps.blocked(chain.project)
    if (reason !== undefined && !['review.notReady', 'agent.copyMissing', 'chain.opencodeCopilot'].includes(reason.code)) throw new NoticeError(reason)
    chain.paused = reason !== undefined
    chain.error = reason ?? null
    if (reason !== undefined) this.deps.log(`chain: ${chain.project} paused: ${englishOf(reason)}`)
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
    if (!this.deps.accountsRead()) return
    await this.cleanups.sweep()
    await this.reviews.sweep()
    await this.waits.settle()
    const seen = new Set<ActiveChain>()
    for (;;) {
      this.fill()
      const chain = this.state.active.find((each) => !seen.has(each))
      if (chain === undefined) return
      seen.add(chain)
      if (!(await this.overage.guard(chain))) continue
      await this.step(chain)
    }
  }

  private async step(chain: ActiveChain): Promise<void> {
    for (;;) {
      if (chain.paused && !this.cleared(chain)) return
      const tasks = this.lists.tasks.get(chain.project)
      if (tasks === undefined) return
      if (chain.closing !== undefined && !(await this.finish(chain, chain.closing))) return
      // Asked to stop, the chain only waits out the session's turn: no Done, handoff or relay is followed meanwhile.
      if (chain.stopAfter) {
        if (chain.current !== null && this.deps.midTurn(chain.current.task)) return
        this.deps.log(`chain: ${chain.project} stopped after its session's turn, as asked`)
        this.stop(chain.project)
        return
      }

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
        if (isCarryName(task)) {
          if (!(await this.carries.follow(chain, chain.current))) {
            await this.handovers.follow(chain, chain.current)
            return
          }
          continue
        }
        if (!tasks.some((open) => open.id === task)) {
          if (this.lists.done.get(chain.project)?.has(task)) {
            chain.current = null
            chain.closing = task
            this.deps.save(this.state)
            continue
          }
          shelve(this.state, this.deps, chain.project, chain.current)
          this.letGo(chain)
          this.deps.save(this.state)
        } else {
          const blockers = openBlockers([...tasks, ...(this.lists.waiting.get(chain.project) ?? [])], task)
          if (blockers.length > 0 && !this.deps.busy(task)) {
            this.release(chain, 'postpone', blockers)
          } else if ((await this.reviews.follow(chain, chain.current)) || (await this.unchanged.follow(chain, chain.current))) {
            // Feedback or a hint went to the session, which leads the chain on; a released or done task left the task list.
            if (chain.current !== null) return
            continue
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
      // A carry goes after the current task and the one a fix interrupted, before the next by the chain's order (BTN-369).
      const carry = fix === undefined && chain.interrupted === undefined ? this.carries.due(chain.project) : undefined
      const own = fix ?? carry
      if (own === undefined && chain.fixOnly) {
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
      const task = own?.task ?? next
      if (task === undefined) {
        this.deps.log(`chain: ${chain.project} ended, no task left to run`)
        this.reviews.ended(chain.project)
        this.drop(chain)
        this.deps.save(this.state)
        return
      }

      const since = this.deps.now().toISOString()
      const live = this.deps.liveSession(task)
      const returned = own === undefined && live !== undefined ? returnedSession(this.state, this.deps, chain.project, task, live) : undefined
      if (live !== undefined && returned === undefined) {
        delete chain.limitUntil
        delete chain.slotWait
        delete chain.ciWait
        this.take(chain, { task, sessionId: live, since })
        this.deps.save(this.state)
        // The feedback on the task's pull request goes to the session at once.
        if (own === undefined && this.reviews.feedbackOf(chain.project, task) !== undefined) continue
        return
      }

      // A handover keeps the task's place and branch: like a relay after a limit, it does not wait for main.
      if (fix === undefined && returned === undefined && this.waits.heldByMain(chain, task, listed)) return

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

      if (returned !== undefined) {
        delete chain.limitUntil
        delete chain.slotWait
        delete chain.ciWait
        const current: CurrentTask = { task, sessionId: returned.session.sessionId, since }
        this.take(chain, current)
        this.deps.save(this.state)
        await this.handovers.handOverCurrent(chain, current, returned.session, returned.reason, returned.extra)
        return
      }

      const lastTry = chain.slotWait === undefined ? undefined : Date.parse(chain.slotWait.at)
      if (lastTry !== undefined && this.deps.now().getTime() - lastTry < SLOT_RETRY_MS) return

      const unjudged = fix === undefined ? this.main?.due(chain.project) : undefined
      if (unjudged !== undefined) {
        if (!(await this.waits.checkMain(chain, task, unjudged))) return
        continue
      }

      delete chain.limitUntil
      const current: CurrentTask = { task, sessionId: null, since, starting: since }
      this.take(chain, current)
      this.deps.save(this.state)
      const feedback = own === undefined ? (this.reviews.feedbackOf(chain.project, task) ?? this.reviews.closedNoteOf(chain.project, task)) : undefined
      await startTask(this.state, this.deps, chain, current, fix, carry, feedback,
        () => this.reviews.delivered(chain.project, task), (failure) => this.halt(chain, failure))
      return
    }
  }

  private async finish(chain: ActiveChain, task: string): Promise<boolean> {
    if (!this.lists.done.get(chain.project)?.has(task)) {
      delete chain.closing
      this.deps.save(this.state)
      return true
    }
    if (this.cleanups.working(task)) {
      if (!this.handovers.quietTooLong(task)) return false
      delete chain.closing
      const released = (this.state.released[chain.project] ??= [])
      if (!released.includes(task)) released.push(task)
      this.deps.save(this.state)
      return true
    }
    await this.cleanups.closeUp(chain.project, task)
    delete chain.closing
    this.deps.save(this.state)
    return true
  }

  /** `keep` — the current task stays current, for the user to act on it (`ReviewHost.hold`). */
  private halt(chain: ActiveChain, error: Notice, keep = false): void {
    if (!keep) this.letGo(chain)
    chain.paused = true
    chain.error = error
    delete chain.limitUntil
    delete chain.slotWait
    delete chain.ciWait
    this.deps.log(`chain: ${chain.project} paused: ${englishOf(error)}`)
    this.deps.save(this.state)
  }

}
