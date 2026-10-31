import { englishOf, noticeOf, type Notice } from '../notice/notice.js'
import { isSpendingLimit } from '../limits/spending.js'
import { LimitRetries } from '../limits/retry.js'
import type { ActiveChain, ChainState, CurrentTask, DispatcherDeps, Move, ReturnReason } from './model.js'
import { isOwnName } from './fix.js'
import {
  answered,
  failedOf,
  handoffPrompt,
  holdOf,
  relayStep,
  withReport,
  withReset,
  type FailedSession,
  type HandoffReason,
  type HandoffSession,
  type LimitedSession,
} from './relay.js'

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
// 1–3, 6 and 9–10): after a limit, on a checkpoint, by "New session", with the user's answer (also once the chain stopped)
// and when a released task returns; and how long an unattended chain waits for a quiet one.
export class Handovers {
  private readonly transientRetries = new LimitRetries()
  /** By task: the session its last handover started and the answered one it carried on from; in memory only. */
  private readonly sources = new Map<string, { sessionId: string; source: HandoffSession; failed: FailedSession[] }>()

  constructor(
    private readonly state: ChainState,
    private readonly deps: DispatcherDeps,
    private readonly halt: (chain: ActiveChain, error: Notice) => void,
  ) {}

  /** The current task's session on each step: a move a service restart cut short, a limit, a checkpoint. */
  async follow(chain: ActiveChain, current: CurrentTask): Promise<void> {
    const refusal = current.sessionId === null ? undefined : this.deps.modelRefusal?.(current.task, current.sessionId)
    if (refusal !== undefined && !this.deps.midTurn(current.task)) {
      this.halt(chain, refusal)
      return
    }
    if (!(await this.recover(chain, current))) return
    if (!(await this.followLimit(chain, current))) await this.followCheckpoint(chain, current)
  }

  async followLimit(chain: ActiveChain, current: CurrentTask): Promise<boolean> {
    const retained = current.limit?.acted === null ? current.limit.overage : undefined
    const overage = retained === undefined ? undefined : { ...retained.session, ...(retained.stopped && { stopped: true as const }) }
    const session = overage ?? this.deps.limited(current.task)
    if (session?.transient === true) return this.followTransient(chain, current, session)
    if (session === undefined) {
      const recovered = this.deps.handoff(current.task)
      const hit = recovered === undefined ? null : this.transientRetries.lastAt(recovered.sessionId)
      if (recovered?.lastReplyAt != null && hit !== null && Date.parse(recovered.lastReplyAt) > Date.parse(hit)) {
        this.transientRetries.reset(recovered.sessionId)
      }
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
      const when = current.limit.resetsAt === null ? 'reset unknown' : `resets at ${current.limit.resetsAt}`
      const next = current.limit.then === 'resume' ? 'resume' : 'new session with handoff'
      this.deps.log(`chain: ${current.task}: limit reached on account ${session.account}; ${when}; next: ${next}`)
    } else if (current.limit.resetsAt === null || isSpendingLimit(session.limit.text)) {
      const reset = this.deps.limitResetAfter(session.account, current.limit.at, session.limit.text)
      if (reset !== null && (current.limit.resetsAt === null || Date.parse(reset) < Date.parse(current.limit.resetsAt))) {
        current.limit = withReset(current.limit, reset, session.warmMs)
        this.deps.save(this.state)
        const next = current.limit.then === 'resume' ? 'resume' : 'new session with handoff'
        this.deps.log(`chain: ${current.task}: limit reset updated to ${current.limit.resetsAt}; next: ${next}`)
      }
    }
    const now = this.deps.now()
    if (overage === undefined) this.reopenEarly(current, session, now)
    const hold = current.limit
    const spentUntil = overage === undefined ? null : this.deps.limitReset(chain.project, current.task)
    if (spentUntil !== null && Date.parse(spentUntil) > now.getTime()) return true
    const step = relayStep(hold, now, this.deps.account(chain.project, current.task), session.warmMs)
    if (step === 'wait') return true

    hold.acted = step
    begin(current, now.toISOString(), step)
    this.deps.save(this.state)
    try {
      const sessionId = step === 'resume' ? await this.deps.resume(current.task, session) : await this.handOver(current.task, session, 'limit')
      this.moved(chain, current, step, sessionId, session.sessionId)
      const how = step === 'resume' ? `resume in session ${sessionId}` : `handoff to new session ${sessionId} from ${session.sessionId}`
      this.deps.log(`chain: ${current.task}: continued after the limit by ${how}`)
    } catch (error) {
      this.halt(chain, noticeOf(error))
    }
    return true
  }

  /** A poll after the refusal found the spent window open before the named reset: the wait ends as if it had come. */
  private reopenEarly(current: CurrentTask, session: LimitedSession, now: Date): void {
    const hold = current.limit!
    if (hold.acted !== null || hold.credit === true || hold.resetsAt === null || isSpendingLimit(session.limit.text)) return
    if (Date.parse(hold.resetsAt) <= now.getTime()) return
    const named = hold.resetsAt
    const open = this.deps.limitReopenedAt(session.account, hold.at, named)
    if (open === null || Date.parse(open) >= Date.parse(named)) return
    current.limit = withReset(hold, open, session.warmMs)
    this.deps.save(this.state)
    const next = current.limit.then === 'resume' ? 'resume' : 'new session with handoff'
    this.deps.log(`chain: ${current.task}: limit on account ${session.account} open again at ${open}, before the named reset at ${named}; next: ${next}`)
  }

  private async followTransient(chain: ActiveChain, current: CurrentTask, session: LimitedSession): Promise<boolean> {
    if (session.sessionId !== current.sessionId) return true
    if (current.resumedAt !== undefined && Date.parse(session.limit.at) <= Date.parse(current.resumedAt)) return true
    if (session.lastReplyAt !== null && Date.parse(session.lastReplyAt) > Date.parse(this.transientRetries.lastAt(session.sessionId) ?? session.limit.at)) {
      this.transientRetries.reset(session.sessionId)
    }
    if (current.limit?.at !== session.limit.at) {
      const resetsAt = this.transientRetries.retryAfter(session.sessionId, session.limit.at)
      current.limit = { at: session.limit.at, account: session.account, resetsAt, lastReplyAt: session.lastReplyAt, then: 'resume', acted: null }
      this.deps.save(this.state)
      this.deps.log(`chain: ${current.task}: temporary model error; retry at ${resetsAt} in session ${session.sessionId}`)
    }
    const hold = current.limit
    if (hold.acted !== null || hold.resetsAt === null || this.deps.now().getTime() < Date.parse(hold.resetsAt)) return true
    if (this.deps.midTurn(current.task) || !this.deps.account(chain.project, current.task).ready || this.deps.blocked(chain.project, current.task) !== undefined) return true
    hold.acted = 'resume'
    begin(current, this.deps.now().toISOString(), 'resume')
    this.deps.save(this.state)
    try {
      const prompt = this.deps.promptLanguage(current.task) === 'ru'
        ? 'Продолжай: предыдущий запрос завершился временной ошибкой модели.'
        : 'Continue: the previous request failed with a temporary model error.'
      const sessionId = await this.deps.reply(current.task, session, prompt)
      this.moved(chain, current, 'resume', sessionId, session.sessionId)
      this.deps.log(`chain: ${current.task}: continued after a temporary model error in session ${sessionId}`)
    } catch (error) {
      this.halt(chain, noticeOf(error))
    }
    return true
  }

  unanswered(current: CurrentTask): boolean {
    if (current.sessionId !== null && this.deps.modelRefusal?.(current.task, current.sessionId) !== undefined) return false
    const paidWait = current.limit?.acted === null && current.limit.overage !== undefined
    if (!this.state.unattended || paidWait || this.deps.midTurn(current.task) || this.deps.limited(current.task) !== undefined) return false
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
  ): Promise<boolean> {
    if (!this.state.active.includes(chain)) {
      return move === 'answer' ? this.deliverLoose(chain.project, current.task, session, prompt) : false
    }
    if (chain.current !== current || current.sessionId !== session.sessionId || this.deps.handoff(current.task)?.sessionId !== session.sessionId) {
      return this.undelivered(current.task, session, 'the current session changed before delivery')
    }
    begin(current, this.deps.now().toISOString(), move)
    current.answering = true
    current.reply = prompt
    if (ask !== null) current.ask = ask
    this.deps.save(this.state)
    try {
      const sessionId = await this.deps.reply(current.task, session, prompt)
      this.moved(chain, current, move, sessionId, session.sessionId)
      return true
    } catch (error) {
      if (move === 'answer') {
        settle(current)
        this.deps.save(this.state)
      } else this.halt(chain, noticeOf(error))
      return this.undelivered(current.task, session, englishOf(noticeOf(error)))
    }
  }

  /** The answer to a session that lives on after its chain stopped: no chain to follow it or to pause on a failure. */
  async deliverLoose(project: string, task: string, session: HandoffSession, prompt: string): Promise<boolean> {
    if (this.deps.handoff(task)?.sessionId !== session.sessionId) return this.undelivered(task, session, 'the session changed before delivery')
    if (this.state.active.some((chain) => chain.project === project)) return this.undelivered(task, session, 'a chain started before delivery')
    const at = this.deps.now().toISOString()
    try {
      const sessionId = await this.deps.reply(task, session, prompt)
      this.deps.journal({ at, project, task, sessionId, reason: 'answer', previous: session.sessionId })
      return true
    } catch (error) {
      return this.undelivered(task, session, englishOf(noticeOf(error)))
    }
  }

  private undelivered(task: string, session: HandoffSession, reason: string): false {
    this.deps.log(`chain: ${task}: the answer did not reach the session ${session.sessionId}: ${reason}`)
    return false
  }

  /** `extra` is kept in `reply` so a service restart can repeat the handover with the same context. */
  async handOverCurrent(
    chain: ActiveChain,
    current: CurrentTask,
    session: HandoffSession,
    reason: 'restart' | 'checkpoint' | 'review' | ReturnReason,
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
    const session = this.deps.handoff(current.task) ?? current.limit?.overage?.session
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
    if (move === 'restart' || move === 'returned' || move === 'unblocked' || move === 'unskipped') {
      await this.handOverCurrent(chain, current, session, move, reply)
      return false
    }
    if (current.limit !== undefined) current.limit.acted = null
    this.deps.save(this.state)
    return true
  }

  /** Returned tasks are relays with their own cause, like a handover after a cold limit. */
  private moved(chain: ActiveChain, current: CurrentTask, move: Move, sessionId: string, previous: string, at = current.starting!): void {
    const returned = move === 'returned' || move === 'unblocked' || move === 'unskipped'
    const reason = returned ? 'relay' : move
    const cause = move === 'relay' ? (current.limit?.credit ? 'credit' : 'limit') : returned ? move : move === 'review' && sessionId !== previous ? 'review' : undefined
    this.deps.journal({ at, project: chain.project, task: current.task, sessionId, reason, ...(cause === undefined ? {} : { cause }), previous })
    current.sessionId = sessionId
    current.resumedAt = at
    if (move === 'answer' || move === 'review') {
      delete current.limit
      this.transientRetries.reset(previous)
    }
    if (sessionId !== previous) this.transientRetries.reset(previous)
    settle(current)
    this.deps.save(this.state)
  }

  /**
   * A session that never answered hands over what the session before it left (BTN-650): its steps, last message, note
   * and transcript, as the handover that started the failed one kept them; the folder and the stop stay the failed one's.
   */
  async handOver(task: string, session: HandoffSession, reason: HandoffReason, extra?: string): Promise<string> {
    const report = isOwnName(task) ? withReport(task, '', this.reportOf(task)) : ''
    const located = await this.deps.locate(session)
    const { source, failed } = this.sourceOf(task, located)
    const { transcript, recent, lastMessage, checkpoint } = source
    const from = source === located ? located : { ...located, transcript, recent, lastMessage, checkpoint }
    const prompt = handoffPrompt(task, from, reason, this.deps.promptLanguage(task), this.deps.mainBranch(task), this.deps.pullRequests?.(task) ?? false, failed)
    const told = extra === undefined ? prompt : `${prompt}\n${extra}\n`
    const sessionId = await this.deps.relay(task, from, told + report, reason)
    this.sources.set(task, { sessionId, source, failed })
    return sessionId
  }

  private sourceOf(task: string, session: HandoffSession): { source: HandoffSession; failed: FailedSession[] } {
    const earlier = this.sources.get(task)
    if (answered(session) || earlier?.sessionId !== session.sessionId) return { source: session, failed: [] }
    return { source: earlier.source, failed: [...earlier.failed, failedOf(session)] }
  }

  private reportOf(task: string): string | undefined {
    const gates = Object.values(this.state.ci)
    return gates.find((gate) => gate.fix?.task === task)?.fix?.report ?? gates.find((gate) => gate.carry?.task === task)?.carry?.report
  }
}
