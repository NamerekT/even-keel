import { englishOf, noticeOf, type Notice } from '../notice/notice.js'
import { isSpendingLimit } from '../limits/spending.js'
import type { ActiveChain, ChainState, CurrentTask, DispatcherDeps, Move } from './model.js'
import { isOwnName } from './fix.js'
import { handoffPrompt, holdOf, relayStep, withReport, withReset, type HandoffReason, type HandoffSession } from './relay.js'

const UNANSWERED_MS = 10 * 60_000

function begin(current: CurrentTask, at: string, move: Move): void {
  current.starting = at
  current.move = move
}

function settle(current: CurrentTask): void {
  delete current.starting
  delete current.move
  delete current.answering
  delete current.reply
  delete current.ask
}

// The session of a chain's current task that the dispatcher continues or replaces itself (invariant 1, exceptions
// 1–3, 6 and 9): after a limit, on a checkpoint, by "New session", with the user's answer (also once the chain stopped)
// and when the task is back from an inactive status; and how long an unattended chain waits for a quiet one.
export class Handovers {
  constructor(
    private readonly state: ChainState,
    private readonly deps: DispatcherDeps,
    private readonly halt: (chain: ActiveChain, error: Notice) => void,
  ) {}

  /** The current task's session on each step: a move a service restart cut short, a limit, a checkpoint. */
  async follow(chain: ActiveChain, current: CurrentTask): Promise<void> {
    if (!(await this.recover(chain, current))) return
    if (!(await this.followLimit(chain, current))) await this.followCheckpoint(chain, current)
  }

  async followLimit(chain: ActiveChain, current: CurrentTask): Promise<boolean> {
    const session = this.deps.limited(current.task)
    if (session === undefined) {
      if (current.limit !== undefined && current.limit.acted === null) {
        delete current.limit
        this.deps.save(this.state)
      }
      return false
    }
    if (current.limit?.at !== session.limit.at) {
      if (this.deps.account(chain.project, current.task).id === null) return true
      const reset = this.deps.limitResetAfter(session.account, session.limit.at, session.limit.text)
      current.limit = holdOf(session, this.deps.accountAt(session.account, session.limit.at), reset)
      this.deps.save(this.state)
    } else if (current.limit.resetsAt === null || isSpendingLimit(session.limit.text)) {
      const reset = this.deps.limitResetAfter(session.account, current.limit.at, session.limit.text)
      if (reset !== null && (current.limit.resetsAt === null || Date.parse(reset) < Date.parse(current.limit.resetsAt))) {
        current.limit = withReset(current.limit, reset, session.warmMs)
        this.deps.save(this.state)
      }
    }
    const hold = current.limit
    const now = this.deps.now()
    const step = relayStep(hold, now, this.deps.account(chain.project, current.task), session.warmMs)
    if (step === 'wait') return true

    hold.acted = step
    begin(current, now.toISOString(), step)
    this.deps.save(this.state)
    try {
      const sessionId = step === 'resume' ? await this.deps.resume(current.task, session) : await this.handOver(current.task, session, 'limit')
      this.moved(chain, current, step, sessionId, session.sessionId)
    } catch (error) {
      this.halt(chain, noticeOf(error))
    }
    return true
  }

  unanswered(current: CurrentTask): boolean {
    if (!this.state.unattended || this.deps.midTurn(current.task) || this.deps.limited(current.task) !== undefined) return false
    const session = this.deps.handoff(current.task)
    if (session === undefined || session.sessionId !== current.sessionId || session.checkpoint !== null) return false
    const moments = [current.since, current.resumedAt, session.lastReplyAt].filter((at) => at != null)
    const quietSince = Math.max(...moments.map((at) => Date.parse(at)))
    return this.deps.now().getTime() - quietSince >= UNANSWERED_MS
  }

  /** Unattended, the chain does not wait past ten quiet minutes for a session of a done task; the sweep cleans up after it. */
  quietTooLong(task: string): boolean {
    const lastReplyAt = this.deps.handoff(task)?.lastReplyAt
    if (!this.state.unattended || lastReplyAt == null) return false
    return this.deps.now().getTime() - Date.parse(lastReplyAt) >= UNANSWERED_MS
  }

  async followCheckpoint(chain: ActiveChain, current: CurrentTask): Promise<void> {
    if (this.deps.busy(current.task)) return
    const session = this.deps.handoff(current.task)
    if (session === undefined || session.checkpoint === null || session.sessionId !== current.sessionId) return
    if (this.deps.blocked(chain.project, current.task) !== undefined || this.deps.limitReset(chain.project, current.task) !== null) return
    await this.handOverCurrent(chain, current, session, 'checkpoint')
  }

  async replace(chain: ActiveChain, current: CurrentTask, replaced: string, session: HandoffSession): Promise<void> {
    if (!this.state.active.includes(chain) || chain.current !== current || current.sessionId !== replaced) return
    await this.handOverCurrent(chain, current, session, 'restart')
  }

  /** The user's answer, or with `review` the feedback on the task's pull request, resumes the waiting session. */
  async deliver(
    chain: ActiveChain,
    current: CurrentTask,
    session: HandoffSession,
    prompt: string,
    ask: string | null,
    move: 'answer' | 'review' = 'answer',
  ): Promise<void> {
    if (!this.state.active.includes(chain) || chain.current !== current || current.sessionId !== session.sessionId) return
    begin(current, this.deps.now().toISOString(), move)
    current.answering = true
    current.reply = prompt
    if (ask !== null) current.ask = ask
    this.deps.save(this.state)
    try {
      const sessionId = await this.deps.reply(current.task, session, prompt)
      this.moved(chain, current, move, sessionId, session.sessionId)
    } catch (error) {
      this.halt(chain, noticeOf(error))
    }
  }

  /** The answer to a session that lives on after its chain stopped: no chain to follow it or to pause on a failure. */
  async deliverLoose(project: string, task: string, session: HandoffSession, prompt: string): Promise<void> {
    if (this.state.active.some((chain) => chain.project === project)) return
    const at = this.deps.now().toISOString()
    try {
      const sessionId = await this.deps.reply(task, session, prompt)
      this.deps.journal({ at, project, task, sessionId, reason: 'answer', previous: session.sessionId })
    } catch (error) {
      this.deps.log(`chain: ${task}: the answer did not reach the session ${session.sessionId}: ${englishOf(noticeOf(error))}`)
    }
  }

  /** `extra` — the feedback a `review` handover carries, kept in `reply` for a service restart to make the move again. */
  async handOverCurrent(
    chain: ActiveChain,
    current: CurrentTask,
    session: HandoffSession,
    reason: 'restart' | 'checkpoint' | 'review' | 'returned',
    extra?: string,
  ): Promise<void> {
    delete current.limit
    begin(current, this.deps.now().toISOString(), reason)
    if (extra !== undefined) current.reply = extra
    this.deps.save(this.state)
    try {
      const sessionId = await this.handOver(current.task, session, reason, extra)
      this.moved(chain, current, reason, sessionId, session.sessionId)
    } catch (error) {
      this.halt(chain, noticeOf(error))
    }
  }

  /**
   * A move of the current session that a service restart cut short (its marks outlived the process): the task has
   * another session — it is taken; the session works, replied after the move began or waits on another question —
   * the move went through; otherwise the move is made again. Returns whether the chain may go on following the task.
   */
  async recover(chain: ActiveChain, current: CurrentTask): Promise<boolean> {
    const { starting, move, reply, ask, answering } = current
    if (starting === undefined || move === undefined) return true
    const session = this.deps.handoff(current.task)
    if (session === undefined) return false
    if (session.sessionId !== current.sessionId) {
      this.deps.log(`chain: ${current.task}: took ${session.sessionId}, started by a ${move} the service did not live to record`)
      this.moved(chain, current, move, session.sessionId, current.sessionId!, starting)
      return true
    }
    const asked = this.deps.asked(current.task)
    const through =
      this.deps.midTurn(current.task) ||
      (session.lastReplyAt !== null && Date.parse(session.lastReplyAt) > Date.parse(starting)) ||
      (asked !== null && asked !== ask)
    if (through) {
      if (move === 'answer' || move === 'resume' || (move === 'review' && answering)) this.moved(chain, current, move, session.sessionId, session.sessionId, starting)
      else settle(current)
      this.deps.save(this.state)
      return true
    }
    this.deps.log(`chain: ${current.task}: a ${move} cut short by a service restart is made again`)
    settle(current)
    if (move === 'answer' && reply !== undefined) {
      await this.deliver(chain, current, session, reply, ask ?? null)
      return false
    }
    if (move === 'review' && reply !== undefined) {
      if (answering) await this.deliver(chain, current, session, reply, null, 'review')
      else await this.handOverCurrent(chain, current, session, 'review', reply)
      return false
    }
    if (move === 'restart' || move === 'returned') {
      await this.handOverCurrent(chain, current, session, move)
      return false
    }
    if (current.limit !== undefined) current.limit.acted = null
    this.deps.save(this.state)
    return true
  }

  /** The journal knows a task back from an inactive status as a `relay`: a handover for a cold cache, as after a limit. */
  private moved(chain: ActiveChain, current: CurrentTask, move: Move, sessionId: string, previous: string, at = current.starting!): void {
    const reason = move === 'returned' ? 'relay' : move
    const cause = move === 'relay' ? 'limit' : move === 'returned' ? 'returned' : move === 'review' && sessionId !== previous ? 'review' : undefined
    this.deps.journal({ at, project: chain.project, task: current.task, sessionId, reason, ...(cause === undefined ? {} : { cause }), previous })
    current.sessionId = sessionId
    current.resumedAt = at
    settle(current)
    this.deps.save(this.state)
  }

  async handOver(task: string, session: HandoffSession, reason: HandoffReason, extra?: string): Promise<string> {
    const report = isOwnName(task) ? withReport(task, '', this.reportOf(task)) : ''
    const located = await this.deps.locate(session)
    const prompt = handoffPrompt(task, located, reason, this.deps.promptLanguage(task), this.deps.mainBranch(task), this.deps.pullRequests?.(task) ?? false)
    const told = extra === undefined ? prompt : `${prompt}\n${extra}\n`
    return this.deps.relay(task, located, told + report, reason)
  }

  private reportOf(task: string): string | undefined {
    const gates = Object.values(this.state.ci)
    return gates.find((gate) => gate.fix?.task === task)?.fix?.report ?? gates.find((gate) => gate.carry?.task === task)?.carry?.report
  }
}
