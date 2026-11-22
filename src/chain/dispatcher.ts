import { taskMoves, type TaskMoves } from '../machine/tasks.js'
import { englishOf, fail, notice, NoticeError, type Notice } from '../notice/notice.js'
import type { SilentRestart } from '../sessions/silence.js'
import { type Task } from '../tracker/model.js'
import { Arrangement } from './arrange.js'
import { MainCarry } from './carry.js'
import { Cleanups } from './cleanup.js'
import { isOwnName } from './fix.js'
import { TaskLists } from './lists.js'
import { MainCheck } from './maincheck.js'
import { MainFix } from './mainfix.js'
import { MainWait } from './mainwait.js'
import { withMilestoneOrder } from './milestone-sequence.js'
import type { ChainView } from './milestones.js'
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
import { goneLanes, laneOf, lanesOf, leaveLane } from './lanes.js'
import { byNumber } from './order.js'
import { LaunchPauses } from './pauses.js'
import { LanePlacement } from './placement.js'
import type { HandoffSession } from './relay.js'
import { quietTooLong } from './quiet.js'
import { Reviews } from './reviews.js'
import { excludes, isDone, isTerminal } from './rules.js'
import { shelve } from './shelved.js'
import { inTurn } from './start.js'
import { followCurrent, launchNext, stopAfterTurn, type StepHost } from './step.js'
import { Talks, USER_HOLDS } from './talk.js'
import { Unchanged } from './unchanged.js'

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

export class Dispatcher {
  private work: Promise<void> = Promise.resolve()
  /** The check of main; the page reads its `view` (BTN-829). */
  readonly main: MainCheck | null
  private readonly fixes: MainFix | null
  private readonly carries: MainCarry
  private readonly handovers: TaskMoves
  private readonly reviews: Reviews
  private readonly unchanged: Unchanged
  private readonly lists: TaskLists
  private readonly cleanups: Cleanups
  private readonly waits: MainWait
  private readonly pauses: LaunchPauses
  private readonly talks: Talks
  private readonly arrange: Arrangement
  private readonly placement: LanePlacement
  private readonly steps: StepHost

  constructor(
    readonly state: ChainState,
    private readonly deps: DispatcherDeps,
  ) {
    this.pauses = new LaunchPauses(state, deps, (project, chain) => this.firstOf(project, chain))
    this.handovers = taskMoves(state, deps, (chain, error, keep) => this.halt(chain, error, keep))
    this.reviews = new Reviews(state, deps, this.handovers, {
      hold: (chain, error) => this.halt(chain, error, true),
      letGo: (chain) => this.letGo(chain),
      release: (project, task) => this.remember(project, task),
      settle: (project, task) => {
        const chain = this.chainOf(project)
        if (chain !== undefined && this.settle(chain, task, 'its pull request is merged')) this.letGo(chain)
      },
      refilter: (project) => this.refilter(project),
      working: (task) => this.cleanups.working(task),
      dropUnmerged: (project, task, pull) => this.cleanups.dropUnmerged(project, task, pull),
    })
    this.unchanged = new Unchanged(deps, this.handovers, (chain, error) => this.halt(chain, error, true))
    this.talks = new Talks(state, deps, this.handovers, this.unchanged, this.pauses, {
      chainOf: (project, task) => this.chainOf(project, task),
      requireProject: (project) => this.requireProject(project),
      done: (project, task) => this.lists.done.get(project)?.has(task) === true,
      closed: (project, task) => this.closed(project, task),
      work: () => this.work,
      setWork: (next) => {
        this.work = next
      },
    })
    this.lists = new TaskLists(state, deps, this.reviews, (project) => this.currentOf(project))
    this.main =
      deps.main === undefined ? null : new MainCheck(state, deps.main, deps.machine, deps.now, deps.log, { save: () => deps.save(state), wake: () => this.changed() })
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
            handOver: (project, task, session, reason, extra) => this.handovers.handOver(project, task, session, reason, extra),
            heldByMain: (chain, task) => this.waits.heldByMain(chain, task, (this.lists.tasks.get(chain.project) ?? []).map((open) => open.id), false),
          })
    this.carries = new MainCarry(state, deps, { closeUp: (project, task) => this.cleanups.closeUp(project, task) })
    this.waits = new MainWait(state, deps, this.main, this.lists, {
      chainOf: (project) => this.chainOf(project),
      halt: (chain, error) => this.halt(chain, error),
      giveBack: (chain) => this.fixes!.giveBack(chain),
    })
    this.arrange = new Arrangement(state, deps, this.lists, this.fixes, this.carries, {
      chainOf: (project, task) => this.chainOf(project, task),
      currentOf: (project) => this.currentOf(project),
      requireProject: (project) => this.requireProject(project),
      release: (chain, reason, blockers) => this.release(chain, reason, blockers),
      changed: () => this.changed(),
    })
    this.placement = new LanePlacement(state, deps, this.lists, this.main, this.reviews)
    this.steps = {
      state,
      deps,
      lists: this.lists,
      main: this.main,
      fixes: this.fixes,
      carries: this.carries,
      handovers: this.handovers,
      reviews: this.reviews,
      unchanged: this.unchanged,
      waits: this.waits,
      pauses: this.pauses,
      placement: this.placement,
      halt: (chain, error, keep) => this.halt(chain, error, keep),
      release: (chain, reason, blockers) => this.release(chain, reason, blockers),
      letGo: (chain) => this.letGo(chain),
      take: (chain, current) => this.take(chain, current),
      drop: (chain) => this.drop(chain),
      stop: (project) => this.stop(project),
      stopLane: (chain) => this.stopLane(chain),
      changed: () => this.changed(),
    }
  }

  setTasks(project: string, read: Task[]): void {
    const tasks = withMilestoneOrder(read, this.deps.milestoneOrder?.(project) ?? [])
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
    if (this.arrange.forgetClosed(project) || placed) this.deps.save(this.state)
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
    const holds = lanesOf(this.state, project).flatMap(({ current }) => (current?.sessionId && !isOwnName(current.task) ? [current.task] : []))
    return [...holds, ...this.released(project).filter((id) => !holds.includes(id))]
  }

  /**
   * `asked` — the released tasks the tracker was asked about: only they are judged, one missing from `tasks` is gone. A
   * task released while the read was on its way is kept for the next read (BTN-766).
   */
  setReleased(project: string, tasks: Task[], asked: string[] = tasks.map((task) => task.id)): void {
    const rules = (id: string) => this.deps.rules(project, id)
    const statuses = new Map(tasks.map((task) => [task.id, task.status]))
    const kept = this.released(project).filter((id) => {
      if (!asked.includes(id)) return true
      const status = statuses.get(id)
      return status !== undefined && (isDone(rules(id), status) || !isTerminal(rules(id), status))
    })
    this.cleanups.done.set(project, new Set(kept.filter((id) => statuses.has(id) && isDone(rules(id), statuses.get(id)!))))
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
    const reason = this.pauses.block(project, this.firstOf(project))
    if (reason !== undefined && !this.pauses.selfClearing(reason.code)) {
      this.deps.log(`chain: ${project} does not start again on feedback: ${englishOf(reason)}`)
      return
    }
    this.deps.log(`chain: ${project} starts again: feedback came on a pull request of its tasks`)
    this.enqueue(project)
  }

  /**
   * Starts or queues the project's chain. With nothing to run by the last task list, it reads the tracker anew
   * first — a task created a moment ago is not in the list yet — and refuses if there is still nothing. So it does with
   * a list `listBlock` calls stale, and refuses while it stays so (BTN-830).
   */
  async start(project: string): Promise<void> {
    this.requireProject(project)
    const chain = this.chainOf(project)
    if (chain?.paused && chain.error?.code === 'review.notOpened') return this.resume(project)
    if (this.going(project)) return
    if (!this.hasWork(project) || this.deps.listBlock?.(project) !== undefined) {
      await this.deps.refresh(project)
      if (this.going(project)) return
      const stale = this.deps.listBlock?.(project)
      if (stale !== undefined) {
        this.deps.log(englishOf(stale))
        throw new NoticeError(stale)
      }
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
    const machines = this.deps.machines
    const machine = machines === undefined ? undefined : this.placement.placeFor(project)
    if (machines === undefined ? active.length < this.deps.parallel() : machine !== undefined) {
      const chain: ActiveChain = machine === undefined ? newChain(project) : { ...newChain(project), machine }
      this.pauses.admit(chain)
      active.push(chain)
    } else queue.push(project)
    this.changed()
  }

  resume(project: string): void {
    const lanes = lanesOf(this.state, project)
    if (lanes.length === 0) return
    for (const chain of lanes) {
      const retry = chain.paused && chain.error?.code === 'review.notOpened' ? chain.current?.task : undefined
      this.pauses.admit(chain)
      if (retry !== undefined) this.reviews.retry(retry)
    }
    this.changed()
  }

  /** Stops every lane of the project. */
  stop(project: string): void {
    this.reviews.stopped(project)
    const lanes = lanesOf(this.state, project)
    if (lanes.length === 0) return
    for (const chain of lanes) this.stopLane(chain)
    this.changed()
  }

  private stopLane(chain: ActiveChain): void {
    this.letGo(chain)
    if (chain.interrupted !== undefined) this.remember(chain.project, chain.interrupted.task)
    this.drop(chain)
  }

  /** Every lane of the project sees its task through and stops. */
  stopAfter(project: string, on: boolean): void {
    let touched = false
    for (const chain of lanesOf(this.state, project)) {
      if ((chain.stopAfter === true) === on) continue
      touched = true
      const { current } = chain
      // A mark the ended turn may carry is the step's to follow first.
      const waits = current !== null && (inTurn(this.deps, current) || (current.sessionId !== null && this.unchanged.closesByMark(current.task)))
      if (on && chain.closing === undefined && !waits) {
        // Nothing to wait out: stop now instead of flashing "stops after the turn" until the next step.
        this.deps.log(`chain: ${chain.project} stopped after its session's turn, as asked`)
        this.reviews.stopped(project)
        this.stopLane(chain)
        continue
      }
      if (on) chain.stopAfter = true
      else delete chain.stopAfter
    }
    if (touched) this.changed()
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
    this.arrange.skip(project, task)
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
    this.talks.restart(project, task, confirmed)
  }

  /**
   * Throws unless the user may answer the session now: it is the current one of the task — of its chain or, once
   * the chain stopped, the one that lives on — waits rather than works, and still waits on the question `ask`
   * (`null` — on none, the turn ended in plain text). With `takes` — the session takes a message mid-turn, by its
   * mailbox (BTN-181) or straight in (BTN-291) — a plain message to a working session passes as `midTurn`: nothing is
   * launched. `fresh` — the answer goes to a new session, checked against the account selected for the task.
   */
  answerable(
    project: string,
    task: string,
    sessionId: string,
    ask: string | null,
    takes = false,
    fresh = false,
  ): { chain: ActiveChain | null; current: CurrentTask | null; session: HandoffSession; midTurn: boolean } {
    return this.talks.answerable(project, task, sessionId, ask, takes, fresh)
  }

  /**
   * The task is over for the chain: done in the tracker's last read, or its branch is in main with commits of its own,
   * which the tracker learns only at the next sweep (BTN-558). Never rejects.
   */
  async closed(project: string, task: string): Promise<boolean> {
    if (this.lists.done.get(project)?.has(task) || this.cleanups.done.get(project)?.has(task)) return true
    return (await this.main?.merged(project, task)) ?? false
  }

  /** Invariant 1, exception 6: queues the user's answer and resolves to whether it reached the session. */
  answer(project: string, task: string, sessionId: string, ask: string | null, prompt: string): Promise<boolean> {
    return this.talks.answer(project, task, sessionId, ask, prompt)
  }

  /**
   * Invariant 1, exceptions 2 and 6 (BTN-757): the user's answer to a waiting session whose cache went cold starts a new
   * session with the handoff and the answer instead of resuming the old one. Only for the current task of a running chain.
   */
  renew(project: string, task: string, sessionId: string, ask: string | null, prompt: string): void {
    this.talks.renew(project, task, sessionId, ask, prompt)
  }

  /** "Accept as answer" (BTN-885): resolves once the task is done in the tracker, rejects with why it was not. */
  accept(project: string, task: string, sessionId: string): Promise<void> {
    return this.talks.accept(project, task, sessionId)
  }

  /**
   * Pauses the lane whose current task is `task`, the task staying current and its session untouched: the merge hook
   * refused an outsider's branch (BTN-1207). `false` — no lane of the project runs the task.
   */
  holdTask(project: string, task: string, why: Notice): boolean {
    const chain = laneOf(this.state, project, task)
    if (chain === undefined || chain.current?.task !== task) return false
    this.halt(chain, why, true)
    this.changed()
    return true
  }

  /**
   * A pause on the task's refused pull request, or on an outsider's branch a person was to land (BTN-1207), ends once
   * the task is merged or done (BTN-715): the chain goes on as on any Done. Pauses for other reasons stay.
   */
  private settle(chain: ActiveChain, task: string, why: string): boolean {
    if (chain.current?.task !== task || !chain.paused || !USER_HOLDS.has(chain.error?.code ?? '')) return false
    this.talks.unhold(chain)
    this.deps.log(`chain: ${chain.project} goes on: ${task}, paused on its unopened pull request, is over: ${why}`)
    this.deps.save(this.state)
    return true
  }

  /** A warning about a finished task's cleanup that came after the cleanup itself: a stop tried again in vain (EKR-99). */
  leftover(project: string, task: string, warning: Notice): void {
    this.cleanups.leftover(project, task, warning)
  }

  dismiss(project: string, task: string): void {
    this.cleanups.dismiss(project, task)
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
    this.arrange.unskip(project, task)
  }

  /** The project's tasks got new ids (BTN-1074, its tracker switched): the saved order and the skips follow. */
  rename(project: string, names: ReadonlyMap<string, string>): void {
    this.arrange.rename(project, names)
  }

  requeue(order: string[]): void {
    this.arrange.requeue(order)
  }

  reorder(project: string, order: string[]): void {
    this.arrange.reorder(project, order)
  }

  orders(): Record<string, ProjectOrder> {
    return this.lists.orders()
  }

  view(project: string): ChainView {
    return this.lists.view(project)
  }

  /** The view `setTasks(project, tasks)` would give, the lists left as they are. */
  preview(project: string, read: Task[]): ChainView {
    return this.lists.preview(project, read)
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
      return this.placement.nextOf(project, tasks) !== undefined
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

  /**
   * The task whose launch the chain waits for: the current one, else the next by the list. `undefined` when unknown
   * or the order is broken — then `blocked` checks no account, and the launch itself does (BTN-521).
   */
  private firstOf(project: string, chain = this.chainOf(project)): string | undefined {
    if (chain?.current != null) return chain.current.task
    try {
      return this.placement.nextOf(project, this.lists.tasks.get(project) ?? [])
    } catch {
      return undefined
    }
  }

  /** The project's head lane; with `task` — the lane holding it, else the head. */
  private chainOf(project: string, task?: string): ActiveChain | undefined {
    return (task === undefined ? undefined : laneOf(this.state, project, task)) ?? this.state.active.find((chain) => chain.project === project)
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

  private changed(): void {
    this.deps.save(this.state)
    this.kick()
  }

  private kick(): void {
    // A failed pass is logged and the next kick runs: a rejected `work` would skip every later pass and stop the service.
    this.work = this.work
      .then(() => this.advance())
      .catch((error: unknown) => this.deps.log(`chain: a pass of the dispatcher failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`))
  }

  /** The task was moved by hand off a machine gone (BTN-1270): its lane there ends, and the project goes on elsewhere. */
  moved(project: string, task: string): void {
    const lane = laneOf(this.state, project, task)
    if (lane === undefined) return
    this.deps.log(`chain: ${task} was moved off machine ${lane.machine ?? this.deps.machines?.own()}: its lane there ends`)
    leaveLane(this.state, lane)
    this.changed()
  }

  private async advance(): Promise<void> {
    await this.deps.machine.catchUp?.()
    if (!this.deps.machine.accountsRead() || !this.deps.machine.sessionsRead()) return
    const gone = this.deps.machines === undefined ? [] : goneLanes(this.state, this.deps.machines)
    for (const lane of gone) {
      this.deps.log(`chain: machine ${lane.machine} of a lane of ${lane.project} was revoked: the lane ends, ${lane.current?.task ?? 'its task'} stays with that machine until moved by hand`)
      leaveLane(this.state, lane)
    }
    if (gone.length > 0) this.deps.save(this.state)
    await this.cleanups.sweep()
    await this.reviews.sweep()
    await this.waits.settle()
    const seen = new Set<ActiveChain>()
    for (;;) {
      this.placement.fill()
      const chain = this.state.active.find((each) => !seen.has(each))
      if (chain === undefined) return
      seen.add(chain)
      try {
        if (!(await this.handovers.guard(chain))) continue
        await this.step(chain)
      } catch (error) {
        // A bug in a step pauses its chain only: thrown on, it would stop the service and every chain with it (BTN-1330).
        this.deps.log(`chain: a step of ${chain.project} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
        this.halt(chain, notice('chain.stepFailed', {}, { detail: error instanceof Error ? error.message : String(error) }), true)
      }
    }
  }

  private async step(chain: ActiveChain): Promise<void> {
    for (;;) {
      const done = chain.current !== null && this.lists.done.get(chain.project)?.has(chain.current.task) === true
      if (chain.paused && !(done && this.settle(chain, chain.current!.task, 'done in the tracker')) && !(await this.pauses.cleared(chain))) return
      const tasks = this.lists.tasks.get(chain.project)
      if (tasks === undefined) return
      if (chain.closing !== undefined && !(await this.finish(chain, chain.closing))) return
      if (chain.stopAfter) {
        if ((await stopAfterTurn(this.steps, chain, tasks)) === 'again') continue
        return
      }
      const current = chain.current
      if (current !== null) {
        const outcome = await followCurrent(this.steps, chain, current, tasks)
        if (outcome === 'again') continue
        if (outcome === 'end') return
      }
      if ((await launchNext(this.steps, chain, tasks)) === 'again') continue
      return
    }
  }

  private finish(chain: ActiveChain, task: string): Promise<boolean> {
    return this.cleanups.finish(chain, task, this.lists.done.get(chain.project)?.has(task) === true, () => quietTooLong(this.state, this.deps, task))
  }

  /** `keep` — the current task stays current, for the user to act on it (`ReviewHost.hold`). */
  private halt(chain: ActiveChain, error: Notice, keep = false): void {
    if (!keep) this.letGo(chain)
    chain.paused = true
    chain.error = error
    delete chain.limitUntil
    delete chain.modelWeek
    delete chain.slotWait
    delete chain.packagesWait
    delete chain.ciWait
    delete chain.limitsWait
    this.deps.log(`chain: ${chain.project} paused: ${englishOf(error)}`)
    this.deps.save(this.state)
  }

}
