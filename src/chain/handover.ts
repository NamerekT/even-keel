import { noticeOf, type Notice } from '../notice/notice.js'
import type { ActiveChain, ChainState, CurrentTask, DispatcherDeps } from './model.js'
import { handoffPrompt, holdOf, relayStep, withReset, type HandoffReason, type HandoffSession } from './relay.js'

const UNANSWERED_MS = 10 * 60_000

// The session of a chain's current task that the dispatcher continues or replaces itself (invariant 1, exceptions
// 1–3 and 6): after a limit, on a checkpoint, by "New session" and with the user's answer; and how long an
// unattended chain waits for a quiet one.
export class Handovers {
  constructor(
    private readonly state: ChainState,
    private readonly deps: DispatcherDeps,
    private readonly halt: (chain: ActiveChain, error: Notice) => void,
  ) {}

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
      if (this.deps.account().id === null) return true
      const reset = this.deps.limitResetAfter(session.account, session.limit.at)
      current.limit = holdOf(session, this.deps.accountAt(session.account, session.limit.at), reset)
      this.deps.save(this.state)
    } else if (current.limit.resetsAt === null) {
      const reset = this.deps.limitResetAfter(session.account, current.limit.at)
      if (reset !== null) {
        current.limit = withReset(current.limit, reset)
        this.deps.save(this.state)
      }
    }
    const hold = current.limit
    const now = this.deps.now()
    const step = relayStep(hold, now, this.deps.account())
    if (step === 'wait') return true

    hold.acted = step
    current.starting = now.toISOString()
    this.deps.save(this.state)
    try {
      const sessionId = step === 'resume' ? await this.deps.resume(current.task, session) : await this.handOver(current.task, session, 'limit')
      this.deps.journal({
        at: now.toISOString(),
        project: chain.project,
        task: current.task,
        sessionId,
        reason: step,
        previous: session.sessionId,
      })
      current.sessionId = sessionId
      current.resumedAt = now.toISOString()
      delete current.starting
      this.deps.save(this.state)
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
    if (this.deps.blocked() !== undefined || this.deps.limitReset() !== null) return
    await this.handOverCurrent(chain, current, session, 'checkpoint')
  }

  async replace(chain: ActiveChain, current: CurrentTask, replaced: string, session: HandoffSession): Promise<void> {
    if (!this.state.active.includes(chain) || chain.current !== current || current.sessionId !== replaced) return
    await this.handOverCurrent(chain, current, session, 'restart')
  }

  async deliver(chain: ActiveChain, current: CurrentTask, session: HandoffSession, prompt: string): Promise<void> {
    if (!this.state.active.includes(chain) || chain.current !== current || current.sessionId !== session.sessionId) return
    const at = this.deps.now().toISOString()
    current.starting = at
    this.deps.save(this.state)
    try {
      const sessionId = await this.deps.reply(current.task, session, prompt)
      this.deps.journal({ at, project: chain.project, task: current.task, sessionId, reason: 'answer', previous: session.sessionId })
      current.sessionId = sessionId
      current.resumedAt = at
      delete current.starting
      this.deps.save(this.state)
    } catch (error) {
      this.halt(chain, noticeOf(error))
    }
  }

  private async handOverCurrent(
    chain: ActiveChain,
    current: CurrentTask,
    session: HandoffSession,
    reason: 'restart' | 'checkpoint',
  ): Promise<void> {
    const at = this.deps.now().toISOString()
    delete current.limit
    current.starting = at
    this.deps.save(this.state)
    try {
      const sessionId = await this.handOver(current.task, session, reason)
      this.deps.journal({ at, project: chain.project, task: current.task, sessionId, reason, previous: session.sessionId })
      current.sessionId = sessionId
      current.resumedAt = at
      delete current.starting
      this.deps.save(this.state)
    } catch (error) {
      this.halt(chain, noticeOf(error))
    }
  }

  async handOver(task: string, session: HandoffSession, reason: HandoffReason, extra?: string): Promise<string> {
    const located = await this.deps.locate(session)
    const prompt = handoffPrompt(task, located, reason, this.deps.promptLanguage(), this.deps.mainBranch(task))
    return this.deps.relay(task, located, extra === undefined ? prompt : `${prompt}\n${extra}\n`, reason)
  }
}
