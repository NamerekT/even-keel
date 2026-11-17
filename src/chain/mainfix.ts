import { shortCommit } from '../ci/verdict.js'
import { fail, noticeOf, type Notice } from '../notice/notice.js'
import type { Task } from '../tracker/model.js'
import { isFixName } from './fix.js'
import { laneMachine, lanesOf } from './lanes.js'
import { waitsForLimits } from './limitNotice.js'
import type { MainCheck } from './maincheck.js'
import { newChain, type ActiveChain, type ChainMachines, type ChainState, type CurrentTask, type DispatcherDeps, type FixOutcome, type LaunchEntry } from './model.js'
import { mainFixedPrompt, warmSince, type HandoffReason, type HandoffSession } from './relay.js'
import { forgetSkipped, rememberSkipped } from './skippedown.js'

/** What the fix of a red main needs of the dispatcher that runs it. */
export interface FixHost {
  halt(chain: ActiveChain, error: Notice): void
  /** Sets the current task aside without touching its session; the chain takes it again when its turn comes. */
  letGo(chain: ActiveChain): void
  take(chain: ActiveChain, current: CurrentTask): void
  /** Remembers a task the chain no longer leads, for the cleanup once it is done. */
  release(project: string, task: string): void
  closeUp(project: string, task: string): Promise<void>
  handOver(project: string, task: string, session: HandoffSession, reason: HandoffReason, extra: string): Promise<string>
  /** Whether the launch waits for the CI's verdict on main. */
  heldByMain(chain: ActiveChain, task: string): boolean
}

/** The lane whose current task began last. */
function latest(lanes: ActiveChain[]): ActiveChain | undefined {
  let found: ActiveChain | undefined
  for (const chain of lanes) {
    if (chain.current !== null && (found === undefined || Date.parse(chain.current.since) > Date.parse(found.current!.since))) found = chain
  }
  return found
}

// A red main without a fix task (BTN-115, `ci.fixTask` off): the fix is a session of its own, the chain's current
// work while it runs. The session of the current task that was mid-turn is stopped for it (invariant 1,
// exception 7) and goes on with a message once the fix is judged.
export class MainFix {
  /** The verdict last seen on the red commit of a fix session that found nothing to fix, for one log line per change. */
  private readonly verdicts = new Map<string, 'green' | 'red' | 'waiting'>()
  /** The projects whose fix found no machine on the link, for one log line until one is found. */
  private readonly unplaced = new Set<string>()

  constructor(
    private readonly state: ChainState,
    private readonly deps: DispatcherDeps,
    private readonly main: MainCheck,
    private readonly host: FixHost,
  ) {}

  /**
   * The lane that runs the project's fix session (BTN-995); `undefined` — none now, the fix waits. Without machines it
   * is the head lane. With them the fix goes to a machine of the project's pool on the link, bound to it for good
   * (`ChainMachines.bind`): first one whose lane of the project waits idle, then one with a free place, where a lane of
   * its own is opened; with none free — the machine of the lane that began its task last, whose session alone makes way.
   * A machine that went off the link after it was bound keeps the fix: only a person moves it.
   */
  fixer(project: string): ActiveChain | undefined {
    const fix = this.main.sessionFix(project)
    const lanes = lanesOf(this.state, project)
    const machines = this.deps.machines
    if (fix === undefined || machines === undefined) return lanes[0]
    const machineOf = (chain: ActiveChain) => laneMachine(chain, machines)
    let bound = machines.holder(project, fix.task)
    if (bound === undefined) {
      bound = this.fixMachine(project, lanes, machines)
      if (bound === undefined) {
        if (!this.unplaced.has(project)) this.deps.log(`chain: ${project}: no machine of its pool is on the link to fix main at ${shortCommit(fix.commit)}; the fix waits`)
        this.unplaced.add(project)
        return undefined
      }
      this.unplaced.delete(project)
      machines.bind(project, fix.task, bound)
      this.deps.log(`chain: ${project}: the fix of main at ${shortCommit(fix.commit)} goes to machine ${bound}`)
    }
    const there = lanes.filter((chain) => machineOf(chain) === bound)
    const lane =
      there.find((chain) => chain.current?.task === fix.task) ??
      there.find((chain) => chain.interrupted?.commit === fix.commit) ??
      there.find((chain) => chain.fixOnly === true || (chain.current === null && chain.interrupted === undefined)) ??
      latest(there)
    if (lane !== undefined || !machines.list().some(({ id }) => id === bound)) return lane
    const opened: ActiveChain = { ...newChain(project), fixOnly: true, ...(bound === machines.own() ? {} : { machine: bound }) }
    this.state.active.push(opened)
    this.deps.save(this.state)
    return opened
  }

  private fixMachine(project: string, lanes: ActiveChain[], machines: ChainMachines): string | undefined {
    const online = machines.list()
    const reachable = lanes.filter((chain) => !chain.paused && online.some(({ id }) => id === laneMachine(chain, machines)))
    const idle = reachable.find((chain) => chain.current === null && chain.interrupted === undefined)
    if (idle !== undefined) return laneMachine(idle, machines)
    const free = online.find(({ id, capacity }) => machines.serves(project, id) && this.state.active.filter((chain) => laneMachine(chain, machines) === id).length < capacity)
    if (free !== undefined) return free.id
    const last = latest(reachable)
    return last === undefined ? undefined : laneMachine(last, machines)
  }

  /**
   * A fix is due while a task's session leads the chain: `true` — the task has made way for it. Only the lane that runs
   * the fix makes way (`fixer`); the others go on and wait for main before their next launch. A working session is
   * stopped; one that waits or sits idle is left as it is, and so is one whose branch is already in main.
   */
  async yields(chain: ActiveChain, current: CurrentTask): Promise<boolean> {
    const fix = this.main.sessionFix(chain.project)
    if (fix === undefined || this.fixer(chain.project) !== chain) return false
    const { task } = current
    const session = this.deps.machine.handoff(task)
    // A missing monitor entry after launch is not evidence that the new turn has ended.
    if (session?.sessionId !== current.sessionId && this.deps.machine.liveSession(task) !== current.sessionId) return false
    if (!this.deps.machine.midTurn(task)) {
      this.host.letGo(chain)
      return true
    }
    if (await this.main.merged(chain.project, task)) return false
    if (session === undefined || session.sessionId !== current.sessionId) return false
    try {
      await this.deps.machine.stop(session)
    } catch (error) {
      this.host.halt(chain, noticeOf(error))
      return true
    }
    chain.interrupted = { task, sessionId: session.sessionId, since: current.since, at: this.deps.now().toISOString(), commit: fix.commit }
    chain.current = null
    this.deps.log(`chain: ${chain.project}: stopped the session ${session.sessionId} of ${task}: main is red at ${shortCommit(fix.commit)}, it goes on after the fix`)
    return true
  }

  /**
   * The fix session leads the chain: `true` — it is over, its branch landed and cleaned up, or the fix is no longer wanted.
   * A session whose turn ended on a background command does not hold a landed fix: the cleanup stops it.
   */
  async follow(chain: ActiveChain, current: CurrentTask): Promise<boolean> {
    const { project } = chain
    const fix = this.main.sessionFix(project)
    if (fix !== undefined && fix.task === current.task) {
      const working = this.deps.machine.busy(current.task) && !this.deps.machine.shell(current.task)
      if (working || !(await this.main.merged(project, fix.task))) return false
      await this.host.closeUp(project, fix.task)
      forgetSkipped(this.state, project, fix.task)
      const head = this.main.fixLanded(project)
      if (chain.interrupted !== undefined && head !== null) chain.interrupted.fixed = head
      this.ended(chain, 'landed', head)
    } else if (isFixName(current.task)) {
      this.ended(chain, 'dropped', null)
    }
    chain.current = null
    this.deps.save(this.state)
    return true
  }

  /**
   * The fix session marked `NO CHANGES:` with a clean branch (EKR-88): main was not broken — a runner failed, a flake —
   * and the session may have rerun the failed jobs. `true` — the red commit is green now, the fix is over and cleaned up;
   * `false` — the verdict is still awaited or still red, and the chain waits for the session as for any other turn.
   */
  async unneeded(chain: ActiveChain, current: CurrentTask): Promise<boolean> {
    const { project } = chain
    const fix = this.main.sessionFix(project)
    if (fix === undefined || fix.task !== current.task) return false
    const verdict = this.main.refixed(project)
    if (this.verdicts.get(current.task) !== verdict) {
      this.verdicts.set(current.task, verdict)
      if (verdict !== 'green') this.deps.log(`chain: ${project}: the fix session ${current.task} found nothing to fix, and ${shortCommit(fix.commit)} is ${verdict === 'red' ? 'still red; it waits for the user' : 'not judged again yet'}`)
    }
    if (verdict !== 'green') return false
    await this.host.closeUp(project, fix.task)
    forgetSkipped(this.state, project, fix.task)
    if (chain.interrupted !== undefined) chain.interrupted.fixed = fix.commit
    this.ended(chain, 'unneeded', fix.commit)
    chain.current = null
    this.deps.save(this.state)
    return true
  }

  /** The stopped session goes on with what happened to main; `false` — not yet, or the chain is halted. */
  async resume(chain: ActiveChain, tasks: Task[]): Promise<boolean> {
    const held = chain.interrupted!
    const { project } = chain
    if (!tasks.some((open) => open.id === held.task) || (this.state.skipped[project] ?? []).includes(held.task)) {
      this.host.release(project, held.task)
      return this.forget(chain)
    }
    const live = this.deps.machine.liveSession(held.task)
    if (live !== undefined && live !== held.sessionId) {
      this.host.take(chain, { task: held.task, sessionId: live, since: held.since })
      return this.forget(chain)
    }
    if (this.host.heldByMain(chain, held.task)) return false
    const blocked = this.deps.blocked(project, held.task)
    if (blocked !== undefined) {
      this.host.halt(chain, blocked)
      return false
    }
    if (waitsForLimits(this.deps, chain, held.task, () => this.deps.save(this.state))) return false
    const reset = this.deps.machine.limitReset(project, held.task)
    if (reset !== null) {
      if (chain.limitUntil !== reset) {
        chain.limitUntil = reset
        this.deps.save(this.state)
      }
      return false
    }
    // The model's own week is used up: the fix waits for it, and only the poll can say when it opens (BTN-816).
    const week = this.deps.machine.modelWeek?.(project, held.task) ?? null
    if (week !== null) {
      if (chain.modelWeek?.model !== week.model || chain.modelWeek.until !== week.until || chain.limitUntil !== undefined) {
        chain.modelWeek = week
        delete chain.limitUntil
        this.deps.save(this.state)
      }
      return false
    }
    const account = this.deps.machine.account(project, held.task)
    if (!account.ready) return false
    const session = this.deps.machine.handoff(held.task)
    if (session === undefined || session.sessionId !== held.sessionId) {
      this.deps.log(`chain: ${project}: the session ${held.sessionId} of ${held.task}, stopped for the fix of main, is not found; the task starts anew`)
      return this.forget(chain)
    }

    const now = this.deps.now()
    const at = now.toISOString()
    const current: CurrentTask = { task: held.task, sessionId: held.sessionId, since: held.since, starting: at }
    delete chain.interrupted
    delete chain.limitUntil
    delete chain.modelWeek
    this.host.take(chain, current)
    this.deps.save(this.state)
    const prompt = mainFixedPrompt(held.commit, held.fixed ?? null, this.deps.promptLanguage(held.task), this.deps.mainBranch(held.task))
    const warm =
      account.id !== null &&
      account.id === this.deps.machine.accountAt(session.account, held.at) &&
      warmSince(session, now.getTime())
    try {
      const sessionId = warm ? await this.deps.machine.reply(held.task, session, prompt) : await this.host.handOver(project, held.task, session, 'mainFixed', prompt)
      this.deps.journal({ at, project, task: held.task, sessionId, reason: warm ? 'resume' : 'relay', cause: 'mainFixed' as const, previous: session.sessionId })
      current.sessionId = sessionId
      current.resumedAt = at
      delete current.starting
      this.deps.save(this.state)
    } catch (error) {
      this.host.halt(chain, noticeOf(error))
    }
    return true
  }

  /** A red push of the fix leaves the stopped session stopped, as the paused chain's current task: the user continues it. */
  giveBack(chain: ActiveChain): void {
    const held = chain.interrupted
    if (held === undefined) return
    delete chain.interrupted
    this.host.take(chain, { task: held.task, sessionId: held.sessionId, since: held.since })
    this.deps.save(this.state)
  }

  /**
   * "Skip" on the fix session: the chain stops waiting for it and main stays as it is; the session is not touched, nor
   * taken for the next fix of the project.
   */
  skip(chain: ActiveChain | undefined, name: string): void {
    if (chain === undefined || chain.current?.task !== name) throw fail('chain.notCurrent', { task: name })
    if (chain.current.sessionId === null) throw fail('chain.launching', { task: name })
    if (this.deps.machine.busy(name)) throw fail('chain.midTurn', { task: name })
    this.main.dropFix(chain.project)
    rememberSkipped(this.state, chain.project, name, chain.current.sessionId)
    this.ended(chain, 'dropped', null)
    chain.current = null
    this.deps.log(`chain: ${chain.project}: the fix session ${name} is skipped, main stays as it is`)
  }

  /** The launch log keeps how the fix ended, for its line in the chain's archive. */
  private ended(chain: ActiveChain, how: FixOutcome, commit: string | null): void {
    const current = chain.current!
    this.verdicts.delete(current.task)
    const entry: LaunchEntry = { at: this.deps.now().toISOString(), project: chain.project, task: current.task, sessionId: current.sessionId ?? '', reason: how }
    if (commit !== null) entry.commit = commit
    this.deps.journal(entry)
  }

  private forget(chain: ActiveChain): boolean {
    delete chain.interrupted
    this.deps.save(this.state)
    return true
  }
}
