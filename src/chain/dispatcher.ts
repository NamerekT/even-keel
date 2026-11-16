import type { Handovers } from '../machine/handover.js'
import type { OverageStops } from '../machine/overage.js'
import { MachineTasks } from '../machine/tasks.js'
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
  type CurrentTask,
  type DispatcherDeps,
  type LaunchEntry,
  type ProjectOrder,
  type ReleaseReason,
} from './model.js'
import { byNumber, chainOrder, nextTask, openBlockers } from './order.js'
import { LaunchPauses } from './pauses.js'
import type { HandoffSession } from './relay.js'
import { Reviews } from './reviews.js'
import { excludes, isDone, isTerminal } from './rules.js'
import { returned as returnedSession, shelve } from './shelved.js'
import { wasSkipped } from './skippedown.js'
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
  private readonly execution: MachineTasks
  private readonly handovers: Handovers
  private readonly reviews: Reviews
  private readonly unchanged: Unchanged
  private readonly lists: TaskLists
  private readonly cleanups: Cleanups
  private readonly waits: MainWait
  private readonly overage: OverageStops
  private readonly pauses: LaunchPauses
  private readonly talks: Talks
  private readonly arrange: Arrangement

  constructor(
    readonly state: ChainState,
    private readonly deps: DispatcherDeps,
  ) {
    this.pauses = new LaunchPauses(state, deps, (project, chain) => this.firstOf(project, chain))
    this.execution = new MachineTasks(state, deps, (chain, error, keep) => this.halt(chain, error, keep))
    this.handovers = this.execution.handovers
    this.overage = this.execution.overage
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
      chainOf: (project) => this.chainOf(project),
      requireProject: (project) => this.requireProject(project),
      done: (project, task) => this.lists.done.get(project)?.has(task) === true,
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
            handOver: (task, session, reason, extra) => this.handovers.handOver(task, session, reason, extra),
            heldByMain: (chain, task) => this.waits.heldByMain(chain, task, (this.lists.tasks.get(chain.project) ?? []).map((open) => open.id), false),
          })
    this.carries = new MainCarry(state, deps, { closeUp: (project, task) => this.cleanups.closeUp(project, task) })
    this.waits = new MainWait(state, deps, this.main, this.lists, {
      chainOf: (project) => this.chainOf(project),
      halt: (chain, error) => this.halt(chain, error),
      giveBack: (chain) => this.fixes!.giveBack(chain),
    })
    this.arrange = new Arrangement(state, deps, this.lists, this.fixes, this.carries, {
      chainOf: (project) => this.chainOf(project),
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
    const current = this.chainOf(project)?.current
    const holds = current?.sessionId && !isOwnName(current.task) ? [current.task] : []
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
    if (active.length < this.deps.parallel()) {
      const chain = newChain(project)
      this.pauses.admit(chain)
      active.push(chain)
    } else queue.push(project)
    this.changed()
  }

  resume(project: string): void {
    const chain = this.chainOf(project)
    if (chain === undefined) return
    const retry = chain.paused && chain.error?.code === 'review.notOpened' ? chain.current?.task : undefined
    this.pauses.admit(chain)
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
    const { current } = chain
    // A mark the ended turn may carry is the step's to follow first.
    const waits = current !== null && (this.execution.inTurn(current) || (current.sessionId !== null && this.unchanged.closesByMark(current.task)))
    if (on && chain.closing === undefined && !waits) {
      // Nothing to wait out: stop now instead of flashing "stops after the turn" until the next step.
      this.deps.log(`chain: ${chain.project} stopped after its session's turn, as asked`)
      this.stop(project)
      return
    }
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
   * launched.
   */
  answerable(
    project: string,
    task: string,
    sessionId: string,
    ask: string | null,
    takes = false,
  ): { chain: ActiveChain | null; current: CurrentTask | null; session: HandoffSession; midTurn: boolean } {
    return this.talks.answerable(project, task, sessionId, ask, takes)
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

  /** The task the chain takes next by its list, the fix of a red main first; `undefined` — none. Throws on a broken order. */
  private nextOf(project: string, tasks: Task[]): string | undefined {
    const order = chainOrder(tasks, this.state.orders[project])
    const skipped = this.state.skipped[project] ?? []
    const open = tasks.map((task) => task.id).filter((id) => !skipped.includes(id))
    return this.main?.fixOf(project, open) ?? this.reviews.next(project, open) ?? nextTask(tasks, order, [...skipped, ...this.lists.waitingIds(project)])
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
    this.work = this.work.then(() => this.advance())
  }

  private async advance(): Promise<void> {
    await this.deps.machine.catchUp?.()
    if (!this.deps.machine.accountsRead() || !this.deps.machine.sessionsRead()) return
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
      const done = chain.current !== null && this.lists.done.get(chain.project)?.has(chain.current.task) === true
      if (chain.paused && !(done && this.settle(chain, chain.current!.task, 'done in the tracker')) && !(await this.pauses.cleared(chain))) return
      const tasks = this.lists.tasks.get(chain.project)
      if (tasks === undefined) return
      if (chain.closing !== undefined && !(await this.finish(chain, chain.closing))) return
      // Asked to stop, the chain only waits out the session's turn: no Done, handoff or relay is followed meanwhile.
      if (chain.stopAfter) {
        const current = chain.current
        if (current !== null && this.execution.inTurn(current)) return
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
            // A fix session that found nothing to fix (EKR-88) is over once the red commit turns green, as after a rerun.
            const mark = await this.unchanged.check(chain, chain.current)
            if (mark === 'acted') return
            if (mark === null || !(await this.fixes.unneeded(chain, chain.current))) {
              await this.handovers.follow(chain, chain.current)
              return
            }
          }
          continue
        }
        // A fix session is not let go by unattended mode: that would launch tasks on a red main (BTN-693).
        if (isCarryName(task)) {
          if (await this.carries.follow(chain, chain.current)) continue
          if (!this.handovers.unanswered(chain.current)) {
            await this.handovers.follow(chain, chain.current)
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
          shelve(this.state, this.deps, chain.project, chain.current)
          this.letGo(chain)
          this.deps.save(this.state)
        } else {
          const blockers = openBlockers([...tasks, ...(this.lists.waiting.get(chain.project) ?? [])], task)
          if (blockers.length > 0 && !this.deps.machine.busy(task)) {
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
      const current: CurrentTask = { task, sessionId: null, since, starting: since }
      this.take(chain, current)
      this.deps.save(this.state)
      const feedback = own === undefined ? (this.reviews.feedbackOf(chain.project, task) ?? this.reviews.closedNoteOf(chain.project, task)) : undefined
      await this.execution.start(chain, current, fix, carry, feedback,
        () => this.reviews.delivered(chain.project, task), (failure) => this.halt(chain, failure))
      return
    }
  }

  private finish(chain: ActiveChain, task: string): Promise<boolean> {
    return this.cleanups.finish(chain, task, this.lists.done.get(chain.project)?.has(task) === true, () => this.handovers.quietTooLong(task))
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
