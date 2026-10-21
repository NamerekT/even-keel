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
import { Cleanups } from './cleanup.js'
import { isFixName } from './fix.js'
import { Handovers } from './handover.js'
import { TaskLists } from './lists.js'
import { MainCheck } from './maincheck.js'
import { MainFix } from './mainfix.js'
import { Reviews } from './reviews.js'
import { Unchanged } from './unchanged.js'
import type { ChainView } from './milestones.js'
import { byNumber, chainOrder, checkOrder, nextTask, openBlockers, startsAhead, waitingBlockers } from './order.js'
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
  type ReviewView,
} from './model.js'

const SLOT_RETRY_MS = 30_000
const SLOT_REFUSALS = new Set(['slot.noneFree', 'slot.busyStart'])

export class Dispatcher {
  private work: Promise<void> = Promise.resolve()
  private readonly main: MainCheck | null
  private readonly fixes: MainFix | null
  private readonly handovers: Handovers
  private readonly reviews: Reviews
  private readonly unchanged: Unchanged
  private readonly lists: TaskLists
  private readonly cleanups: Cleanups

  constructor(
    readonly state: ChainState,
    private readonly deps: DispatcherDeps,
  ) {
    this.handovers = new Handovers(state, deps, (chain, error) => this.halt(chain, error))
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
            heldByMain: (chain, task) => this.heldByMain(chain, task, (this.lists.tasks.get(chain.project) ?? []).map((open) => open.id), false),
          })
  }

  setTasks(project: string, tasks: Task[]): void {
    this.lists.listed.set(project, tasks)
    const rules = this.deps.rules(project)
    const admitted = tasks.filter((task) => admits(rules, task))
    const chain = admitted.filter((task) => this.enters(project, task, rules))
    const outside = (this.lists.outside.get(project) ?? []).filter((task) => isOpen(task.status))
    const waiting = waitingBlockers(chain, [...tasks, ...outside].filter((task) => !isTerminal(rules, task.status) && !chain.includes(task)))
    const backlog = tasks.filter(
      (task) => !excludes(rules, task) && !chain.includes(task) && !waiting.includes(task) && !this.reviews.holds(project, task.id),
    )
    this.lists.tasks.set(project, chain)
    this.lists.waiting.set(project, waiting)
    this.lists.backlog.set(project, backlog.sort((a, b) => byNumber(a.id, b.id)))
    this.lists.done.set(project, new Set(tasks.filter((task) => isDone(rules, task.status)).map((task) => task.id)))
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
    this.cleanups.done.set(project, new Set(kept.filter((id) => isDone(rules, statuses.get(id)!))))
    if (kept.length !== this.released(project).length) {
      this.cleanups.keepReleased(project, kept)
      this.deps.save(this.state)
    }
    this.kick()
  }

  private enters(project: string, task: Task, rules: ChainRules): boolean {
    const current = this.currentOf(project) === task.id
    if (this.reviews.holds(project, task.id) && !current) return false
    if (isActive(rules, task.status)) return true
    return current && this.deps.busy(task.id)
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
      for (const touched of await this.reviews.apply(polled)) this.refilter(touched)
    })
    await this.work
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
    return [...this.lists.maps(), this.cleanups.done]
  }

  skip(project: string, task: string): void {
    this.requireProject(project)
    if (this.fixes !== null && isFixName(task)) {
      this.fixes.skip(this.chainOf(project), task)
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
    this.work = this.work.then(() => {
      this.unhold(chain)
      return this.handovers.replace(chain, current, replaced, session)
    })
  }

  /**
   * Throws unless the user may answer the session now: it is the current one of the task — of its chain or, once
   * the chain stopped, the one that lives on — waits rather than works, and still waits on the question `ask`
   * (`null` — on none, the turn ended in plain text). With `mailbox` — the session's hooks take mail — a plain
   * message to a working session passes as `midTurn`: it goes into the mailbox, nothing is launched (BTN-181).
   */
  answerable(
    project: string,
    task: string,
    sessionId: string,
    ask: string | null,
    mailbox = false,
  ): { chain: ActiveChain | null; current: CurrentTask | null; session: HandoffSession; midTurn: boolean } {
    this.requireProject(project)
    const chain = this.chainOf(project) ?? null
    const current = chain?.current?.task === task ? chain.current : null
    if (chain !== null && current === null) throw fail('chain.notCurrent', { task })
    if (current !== null && (current.sessionId === null || current.starting !== undefined)) throw fail('chain.launching', { task })
    const session = this.deps.handoff(task)
    if ((current !== null && current.sessionId !== sessionId) || session?.sessionId !== sessionId || this.deps.asked(task) !== ask) {
      throw fail('answer.moved', { task })
    }
    if (this.deps.midTurn(task)) {
      if (!mailbox || ask !== null) throw fail('answer.busy', { task })
      return { chain, current, session, midTurn: true }
    }
    this.requireLaunches(project, task)
    const reset = this.deps.limitReset(project, task)
    if (reset !== null) throw fail('chain.limitSpent', { until: reset })
    return { chain, current, session, midTurn: false }
  }

  /** Invariant 1, exception 6: the user's own answer resumes the session that waits for it. */
  answer(project: string, task: string, sessionId: string, ask: string | null, prompt: string): void {
    const { chain, current, session } = this.answerable(project, task, sessionId, ask)
    this.work = this.work.then(() => {
      if (chain === null || current === null) return this.handovers.deliverLoose(project, task, session, prompt)
      this.unhold(chain)
      return this.handovers.deliver(chain, current, session, prompt, ask)
    })
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

  /**
   * The current task left the chain for an inactive status (BTN-245) with no question of its own session open: most
   * likely the session asked in the tracker, so once the task is back a new session takes it (`returned`). A busy
   * session keeps its task in the chain (`enters`), so the task leaves only once the turn has ended.
   */
  private shelve(project: string, current: CurrentTask): void {
    const { task, sessionId } = current
    if (sessionId === null || this.deps.asked(task) !== null) return
    const shelved = (this.state.shelved[project] ?? []).filter((each) => each.task !== task)
    this.state.shelved[project] = [...shelved, { task, sessionId, at: this.deps.now().toISOString() }]
  }

  /**
   * The session a shelved task left behind, to be replaced now the task is back (invariant 1, exception 9): only while
   * it is not mid-turn, waits on no question of its own and got no prompt or answer since — then someone talked to it.
   */
  private returned(project: string, task: string, live: string): HandoffSession | undefined {
    const shelved = this.state.shelved[project]?.find((each) => each.task === task)
    if (shelved?.sessionId !== live || this.deps.midTurn(task) || this.deps.asked(task) !== null) return undefined
    const session = this.deps.handoff(task)
    if (session?.sessionId !== live) return undefined
    const since = Date.parse(shelved.at)
    const talked = session.recent.some((line) => (line.kind === 'prompt' || line.kind === 'answer') && Date.parse(line.at) > since)
    return talked ? undefined : session
  }

  private take(chain: ActiveChain, current: CurrentTask): void {
    chain.current = current
    const released = this.released(chain.project)
    if (released.includes(current.task)) this.cleanups.keepReleased(chain.project, released.filter((id) => id !== current.task))
  }

  private async settleMain(): Promise<void> {
    if (this.main === null) return
    const { changed, stops, fixes } = await this.main.settle(this.lists.listedOpen)
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
    const stop = await this.main!.checkLocally(chain.project, task, this.lists.listedOpen)
    delete chain.ciWait
    this.deps.save(this.state)
    if (stop === null) return true
    this.halt(chain, stop)
    return false
  }

  /** A pause because PR mode had nowhere to go ends by itself once it has: a remote or a token added (EKR-12). */
  private cleared(chain: ActiveChain): boolean {
    if (chain.error?.code !== 'review.notReady' || this.deps.blocked(chain.project) !== undefined) return false
    chain.paused = false
    chain.error = null
    this.deps.log(`chain: ${chain.project} goes on: PR mode has where to open pull requests`)
    this.deps.save(this.state)
    return true
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
    await this.cleanups.sweep()
    await this.reviews.sweep()
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
        if (!tasks.some((open) => open.id === task)) {
          if (this.lists.done.get(chain.project)?.has(task)) {
            chain.current = null
            chain.closing = task
            this.deps.save(this.state)
            continue
          }
          this.shelve(chain.project, chain.current)
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
      const returned = fix === undefined && live !== undefined ? this.returned(chain.project, task, live) : undefined
      if (live !== undefined && returned === undefined) {
        delete chain.limitUntil
        delete chain.slotWait
        delete chain.ciWait
        this.take(chain, { task, sessionId: live, since })
        this.deps.save(this.state)
        // The feedback on the task's pull request goes to the session at once.
        if (fix === undefined && this.reviews.feedbackOf(chain.project, task) !== undefined) continue
        return
      }

      // A handover keeps the task's place and branch: like a relay after a limit, it does not wait for main.
      if (fix === undefined && returned === undefined && this.heldByMain(chain, task, listed)) return

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
        const current: CurrentTask = { task, sessionId: returned.sessionId, since }
        this.take(chain, current)
        this.deps.save(this.state)
        await this.handovers.handOverCurrent(chain, current, returned, 'returned')
        return
      }

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
      const feedback = fix === undefined ? (this.reviews.feedbackOf(chain.project, task) ?? this.reviews.closedNoteOf(chain.project, task)) : undefined
      try {
        const { sessionId, fallback } =
          fix !== undefined
            ? { sessionId: await this.deps.launchFix(chain.project, task, fix.report) }
            : feedback !== undefined
              ? await this.deps.launch(chain.project, task, feedback)
              : await this.deps.launch(chain.project, task)
        if (feedback !== undefined) this.reviews.delivered(chain.project, task)
        this.deps.journal({
          at: since,
          project: chain.project,
          task,
          sessionId,
          ...(fix !== undefined && { commit: fix.commit }),
          ...(feedback !== undefined && { reason: 'review' as const }),
          ...(fallback !== undefined && { fallback }),
        })
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

  /** The task never started, so it is not released: the chain picks it again once a slot frees up. */
  private waitForSlot(chain: ActiveChain, task: string, refusal: Notice): void {
    chain.current = null
    const waiting = notice('slot.waiting', { task }, { items: refusal.items ?? [refusal] })
    if (!sameNotice(chain.slotWait?.notice ?? null, waiting)) this.deps.log(`chain: ${chain.project}: ${englishOf(waiting)}`)
    chain.slotWait = { notice: waiting, at: this.deps.now().toISOString() }
    this.deps.save(this.state)
  }
}
