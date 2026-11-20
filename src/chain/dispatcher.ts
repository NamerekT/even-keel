import { taskMoves, type TaskMoves } from '../machine/tasks.js'
import { englishOf, fail, notice, NoticeError, noticeOf, type Notice } from '../notice/notice.js'
import type { SilentRestart } from '../sessions/silence.js'
import { type Task } from '../tracker/model.js'
import { Arrangement } from './arrange.js'
import { MainCarry } from './carry.js'
import { Cleanups } from './cleanup.js'
import { isCarryName, isFixName, isOwnName } from './fix.js'
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
  type ChainMachines,
  type CurrentTask,
  type DispatcherDeps,
  type LaunchEntry,
  type ProjectOrder,
  type ReleaseReason,
} from './model.js'
import { goneLanes, heldFrom, laneMachine, laneOf, lanesOf, leaveLane, widens } from './lanes.js'
import { moveOffLimit } from './limit-moves.js'
import { byNumber, chainOrder, nextTask, openBlockers } from './order.js'
import { LaunchPauses } from './pauses.js'
import type { HandoffSession } from './relay.js'
import { quietTooLong, unanswered } from './quiet.js'
import { Reviews } from './reviews.js'
import { excludes, isDone, isTerminal } from './rules.js'
import { returned as returnedSession, shelve } from './shelved.js'
import { wasSkipped } from './skippedown.js'
import { inTurn, startTask } from './start.js'
import { Talks } from './talk.js'
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

const SLOT_RETRY_MS = 30_000

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
    const machine = machines === undefined ? undefined : this.placeFor(project)
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
   * A pause on the task's refused pull request ends once the task is merged or done (BTN-715): the chain goes on as on
   * any Done. Pauses for other reasons stay.
   */
  private settle(chain: ActiveChain, task: string, why: string): boolean {
    if (chain.current?.task !== task || !chain.paused || chain.error?.code !== 'review.notOpened') return false
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

  /**
   * The task the chain takes next by its list, the fix of a red main first; `undefined` — none. Throws on a broken order.
   * With `machine` — what a lane on it may take (BTN-993): no task another lane or machine holds, none it cannot run,
   * and the fix of main only in the project's head lane.
   */
  private nextOf(project: string, tasks: Task[], machine?: string, lane?: ActiveChain): string | undefined {
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

  /**
   * The task whose launch the chain waits for: the current one, else the next by the list. `undefined` when unknown
   * or the order is broken — then `blocked` checks no account, and the launch itself does (BTN-521).
   */
  private firstOf(project: string, chain = this.chainOf(project)): string | undefined {
    if (chain?.current != null) return chain.current.task
    try {
      return this.nextOf(project, this.lists.tasks.get(project) ?? [])
    } catch {
      return undefined
    }
  }

  /** The project's head lane; with `task` — the lane holding it, else the head. */
  private chainOf(project: string, task?: string): ActiveChain | undefined {
    return (task === undefined ? undefined : laneOf(this.state, project, task)) ?? this.state.active.find((chain) => chain.project === project)
  }

  /** The machine whose capacity the lane takes; `undefined` — no machines, only `parallel` counts. */
  private machineOf(chain: ActiveChain): string | undefined {
    return this.deps.machines === undefined ? undefined : laneMachine(chain, this.deps.machines)
  }

  /**
   * The machine a new lane of the project goes to (BTN-993): the first listed one with a free place that serves the
   * project and has a task of it to run — a project with lanes already only while they all go plainly and fewer than
   * its width. A project whose tasks no machine can take now goes to none; `undefined` — no machine takes it now.
   */
  private placeFor(project: string, only?: string): string | undefined {
    const machines = this.deps.machines!
    const lanes = lanesOf(this.state, project)
    if (lanes.length > 0 && (lanes.length >= machines.width(project) || !widens(lanes))) return undefined
    for (const { id, capacity } of machines.list()) {
      if (only !== undefined && id !== only) continue
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

  /** The task the chain leads; while a fix session of main runs — the task it interrupted, if any. */
  private currentOf(project: string): string | undefined {
    const chain = this.chainOf(project)
    const task = chain?.current?.task
    return task === undefined || isOwnName(task) ? chain?.interrupted?.task : task
  }

  private drop(chain: ActiveChain): void {
    this.state.active = this.state.active.filter((each) => each !== chain)
  }

  /**
   * Takes queued projects while fewer chains than `parallel` are active; a lowered `parallel` stops nothing that runs.
   * With machines (BTN-993) each machine with a free place pulls: the first project by the chain's order — the active
   * ones, then the queue — that `placeFor` gives it gets a lane there.
   */
  private fill(): void {
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
      this.fill()
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
      // Asked to stop, the chain only waits out the session's turn: no Done, handoff or relay is followed meanwhile.
      if (chain.stopAfter) {
        const current = chain.current
        if (current !== null && inTurn(this.deps, current)) return
        // Only the dispatcher closes a task of a project without git, so the mark the turn ended with is still followed (BTN-1044).
        const closes = current !== null && current.sessionId !== null && this.unchanged.closesByMark(current.task) && tasks.some((open) => open.id === current.task)
        if (closes && (await this.unchanged.follow(chain, current))) {
          if (chain.paused) return
          if (this.lists.done.get(chain.project)?.has(current.task)) {
            chain.current = null
            chain.closing = current.task
            this.deps.save(this.state)
            continue
          }
        }
        this.deps.log(`chain: ${chain.project} stopped after its session's turn, as asked`)
        if (lanesOf(this.state, chain.project).length > 1) {
          this.stopLane(chain)
          this.changed()
        } else this.stop(chain.project)
        return
      }

      const current = chain.current
      if (current !== null) {
        const { task, sessionId } = current
        // A skip or a release from the page may end the task while the step awaits (BTN-1330): the step starts over.
        const moved = () => chain.current !== current
        if (sessionId === null) {
          this.halt(chain, notice('chain.interrupted', { task }))
          return
        }
        if (isFixName(task)) {
          if (this.fixes === null) chain.current = null
          else if (!(await this.fixes.follow(chain, current)) && !moved()) {
            // A fix session that found nothing to fix (EKR-88) is over once the red commit turns green, as after a rerun,
            // or main is green past it (BTN-1328); one that ended its turn otherwise is let go once main is green past it.
            const mark = await this.unchanged.check(chain, current)
            if (moved()) continue
            if (mark === 'acted') return
            const over = mark === null ? await this.fixes.outrun(chain, current) : await this.fixes.unneeded(chain, current)
            if (!over) {
              if (moved()) continue
              await this.handovers.follow(chain, current)
              return
            }
          }
          continue
        }
        // A fix session is not let go by unattended mode: that would launch tasks on a red main (BTN-693).
        if (isCarryName(task)) {
          if ((await this.carries.follow(chain, current)) || moved()) continue
          if (!unanswered(this.state, this.deps, current)) {
            await this.handovers.follow(chain, current)
            return
          }
          this.carries.letGo(chain, 'is let go after ten quiet minutes in unattended mode')
          this.deps.save(this.state)
          continue
        }
        if (!tasks.some((open) => open.id === task)) {
          if (this.lists.done.get(chain.project)?.has(task)) {
            chain.current = null
            chain.closing = task
            this.deps.save(this.state)
            continue
          }
          shelve(this.state, this.deps, chain.project, current)
          this.letGo(chain)
          this.deps.save(this.state)
        } else {
          const blockers = openBlockers([...tasks, ...(this.lists.waiting.get(chain.project) ?? [])], task)
          if (blockers.length > 0 && !this.deps.machine.busy(task)) {
            this.release(chain, 'postpone', blockers)
          } else if ((await this.reviews.follow(chain, current)) || moved() || (await this.unchanged.follow(chain, current)) || moved()) {
            // Feedback or a hint went to the session, which leads the chain on; a released or done task left the task list.
            if (chain.current !== null) return
            continue
          } else if (unanswered(this.state, this.deps, current)) {
            const skipped = (this.state.skipped[chain.project] ??= [])
            if (!skipped.includes(task)) skipped.push(task)
            this.release(chain, 'skip', [])
          } else if (this.fixes === null || !(await this.fixes.yields(chain, current))) {
            if (moved()) continue
            await this.handovers.follow(chain, current)
            return
          }
          this.deps.save(this.state)
          if (chain.paused) return
        }
      }

      // Only the project's head lane carries a release project in (BTN-993); the lane `fixer` chose fixes main (BTN-995).
      const head = lanesOf(this.state, chain.project)[0] === chain
      const fix = this.fixes?.fixer(chain.project) === chain ? this.main?.sessionFix(chain.project) : undefined
      // A carry goes after the current task and the one a fix interrupted, before the next by the chain's order (BTN-369).
      const carry = head && fix === undefined && chain.interrupted === undefined ? this.carries.due(chain.project) : undefined
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
      const machine = this.machineOf(chain)
      try {
        next = this.nextOf(chain.project, tasks, machine, chain)
      } catch (error) {
        this.halt(chain, noticeOf(error))
        return
      }

      const listed = tasks.map((open) => open.id)
      const task = own?.task ?? next
      if (task === undefined) {
        this.endLane(chain, tasks)
        return
      }
      // `nextOf` gave no task another machine holds: from here on its facts and launch are the lane's machine's.
      if (machine !== undefined && own === undefined) this.deps.machines!.bind(chain.project, task, machine)

      const since = this.deps.now().toISOString()
      const found = this.deps.machine.liveSession(task)
      // A fix or carry session the user skipped lives on under the name of the next one, which starts a session of its own.
      const live = own !== undefined && found !== undefined && wasSkipped(this.state, chain.project, task, found) ? undefined : found
      const returned = own === undefined && live !== undefined ? returnedSession(this.state, this.deps, chain.project, task, live) : undefined
      if (live !== undefined && returned === undefined) {
        delete chain.limitUntil
        delete chain.modelWeek
        delete chain.slotWait
        delete chain.ciWait
        delete chain.limitsWait
        this.take(chain, { task, sessionId: live, since })
        this.deps.save(this.state)
        // The feedback on the task's pull request goes to the session at once.
        if (own === undefined && this.reviews.feedbackOf(chain.project, task) !== undefined) continue
        return
      }

      const left = own === undefined && live === undefined ? this.unchanged.left(chain.project, task) : undefined
      if (left !== undefined) {
        this.deps.log(`chain: ${task} is not started again: its session ${left} is over and its last turn ended with the mark`)
        this.take(chain, { task, sessionId: left, since })
        this.deps.save(this.state)
        continue
      }

      // A handover keeps the task's place and branch: like a relay after a limit, it does not wait for main.
      if (fix === undefined && returned === undefined && this.waits.heldByMain(chain, task, listed)) return

      const blocked = this.pauses.block(chain.project, task)
      if (blocked !== undefined) {
        this.halt(chain, blocked)
        return
      }

      if (own === undefined && returned === undefined && moveOffLimit(this.state, this.deps, chain, task)) continue
      if (this.pauses.waits(chain, task, fix !== undefined)) return

      if (returned !== undefined) {
        delete chain.limitUntil
        delete chain.modelWeek
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
      delete chain.modelWeek
      const starting: CurrentTask = { task, sessionId: null, since, starting: since }
      this.take(chain, starting)
      this.deps.save(this.state)
      const feedback = own === undefined ? (this.reviews.feedbackOf(chain.project, task) ?? this.reviews.closedNoteOf(chain.project, task)) : undefined
      await startTask(this.state, this.deps, chain, starting, fix, carry, feedback,
        () => this.reviews.delivered(chain.project, task), (failure) => this.halt(chain, failure))
      return
    }
  }

  /**
   * The lane has no task to take. Another lane of the project goes on: only this one ends. The last one ends the chain,
   * unless a task is left that no machine of the lanes may take now — then the project waits in the queue for one.
   */
  private endLane(chain: ActiveChain, tasks: Task[]): void {
    const machine = this.machineOf(chain)
    this.drop(chain)
    if (lanesOf(this.state, chain.project).length > 0) {
      this.deps.log(`chain: a lane of ${chain.project} on machine ${machine} ends, no task left for it`)
    } else if (machine !== undefined && this.nextOf(chain.project, tasks) !== undefined) {
      this.deps.log(`chain: ${chain.project} waits for a machine that may take its next task`)
      this.state.queue.unshift(chain.project)
    } else {
      this.deps.log(`chain: ${chain.project} ended, no task left to run`)
      this.reviews.ended(chain.project)
    }
    this.deps.save(this.state)
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
    delete chain.ciWait
    delete chain.limitsWait
    this.deps.log(`chain: ${chain.project} paused: ${englishOf(error)}`)
    this.deps.save(this.state)
  }

}
