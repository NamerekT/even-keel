import { shortCommit } from '../ci/verdict.js'
import { fail, noticeOf, type Notice } from '../notice/notice.js'
import type { Task } from '../tracker/model.js'
import { isFixName } from './fix.js'
import type { MainCheck } from './maincheck.js'
import type { ActiveChain, ChainState, CurrentTask, DispatcherDeps, FixOutcome, LaunchEntry } from './model.js'
import { mainFixedPrompt, WARM_CACHE_MS, type HandoffReason, type HandoffSession } from './relay.js'

/** What the fix of a red main needs of the dispatcher that runs it. */
export interface FixHost {
  halt(chain: ActiveChain, error: Notice): void
  /** Sets the current task aside without touching its session; the chain takes it again when its turn comes. */
  letGo(chain: ActiveChain): void
  take(chain: ActiveChain, current: CurrentTask): void
  /** Remembers a task the chain no longer leads, for the cleanup once it is done. */
  release(project: string, task: string): void
  closeUp(project: string, task: string): Promise<void>
  handOver(task: string, session: HandoffSession, reason: HandoffReason, extra: string): Promise<string>
  /** Whether the launch waits for the CI's verdict on main. */
  heldByMain(chain: ActiveChain, task: string): boolean
}

// A red main without a fix task (BTN-115, `ci.fixTask` off): the fix is a session of its own, the chain's current
// work while it runs. The session of the current task that was mid-turn is stopped for it (invariant 1,
// exception 7) and goes on with a message once the fix is judged.
export class MainFix {
  constructor(
    private readonly state: ChainState,
    private readonly deps: DispatcherDeps,
    private readonly main: MainCheck,
    private readonly host: FixHost,
  ) {}

  /**
   * A fix is due while a task's session leads the chain: `true` — the task has made way for it. A working session
   * is stopped; one that waits or sits idle is left as it is, and so is one whose branch is already in main.
   */
  async yields(chain: ActiveChain, current: CurrentTask): Promise<boolean> {
    const fix = this.main.sessionFix(chain.project)
    if (fix === undefined) return false
    const { task } = current
    if (!this.deps.midTurn(task)) {
      this.host.letGo(chain)
      return true
    }
    if (await this.main.merged(chain.project, task)) return false
    const session = this.deps.handoff(task)
    if (session === undefined || session.sessionId !== current.sessionId) return false
    try {
      await this.deps.stop(session)
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
      const working = this.deps.busy(current.task) && !this.deps.shell(current.task)
      if (working || !(await this.main.merged(project, fix.task))) return false
      await this.host.closeUp(project, fix.task)
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

  /** The stopped session goes on with what happened to main; `false` — not yet, or the chain is halted. */
  async resume(chain: ActiveChain, tasks: Task[]): Promise<boolean> {
    const held = chain.interrupted!
    const { project } = chain
    if (!tasks.some((open) => open.id === held.task) || (this.state.skipped[project] ?? []).includes(held.task)) {
      this.host.release(project, held.task)
      return this.forget(chain)
    }
    const live = this.deps.liveSession(held.task)
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
    const reset = this.deps.limitReset(project, held.task)
    if (reset !== null) {
      if (chain.limitUntil !== reset) {
        chain.limitUntil = reset
        this.deps.save(this.state)
      }
      return false
    }
    const account = this.deps.account(project, held.task)
    if (!account.ready) return false
    const session = this.deps.handoff(held.task)
    if (session === undefined || session.sessionId !== held.sessionId) {
      this.deps.log(`chain: ${project}: the session ${held.sessionId} of ${held.task}, stopped for the fix of main, is not found; the task starts anew`)
      return this.forget(chain)
    }

    const now = this.deps.now()
    const at = now.toISOString()
    const current: CurrentTask = { task: held.task, sessionId: held.sessionId, since: held.since, starting: at }
    delete chain.interrupted
    delete chain.limitUntil
    this.host.take(chain, current)
    this.deps.save(this.state)
    const prompt = mainFixedPrompt(held.commit, held.fixed ?? null, this.deps.promptLanguage(held.task), this.deps.mainBranch(held.task))
    const warm =
      account.id !== null &&
      account.id === this.deps.accountAt(session.account, held.at) &&
      session.lastReplyAt !== null &&
      now.getTime() - Date.parse(session.lastReplyAt) < WARM_CACHE_MS
    try {
      const sessionId = warm ? await this.deps.reply(held.task, session, prompt) : await this.host.handOver(held.task, session, 'mainFixed', prompt)
      this.deps.journal({ at, project, task: held.task, sessionId, reason: warm ? 'resume' : 'relay', ...(warm ? {} : { cause: 'mainFixed' as const }), previous: session.sessionId })
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

  /** "Skip" on the fix session: the chain stops waiting for it and main stays as it is; the session is not touched. */
  skip(chain: ActiveChain | undefined, name: string): void {
    if (chain === undefined || chain.current?.task !== name) throw fail('chain.notCurrent', { task: name })
    if (chain.current.sessionId === null) throw fail('chain.launching', { task: name })
    if (this.deps.busy(name)) throw fail('chain.midTurn', { task: name })
    this.main.dropFix(chain.project)
    this.ended(chain, 'dropped', null)
    chain.current = null
    this.deps.log(`chain: ${chain.project}: the fix session ${name} is skipped, main stays as it is`)
  }

  /** The launch log keeps how the fix ended, for its line in the chain's archive. */
  private ended(chain: ActiveChain, how: FixOutcome, commit: string | null): void {
    const current = chain.current!
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
