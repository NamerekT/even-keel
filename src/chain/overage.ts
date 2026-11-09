import { noticeOf, type Notice } from '../notice/notice.js'
import type { ActiveChain, ChainState, DispatcherDeps } from './model.js'
import { holdOf } from './relay.js'

/** Stops only current chain sessions; its hold survives loss of the provider reading, the process and the service. */
export class OverageStops {
  constructor(private readonly state: ChainState, private readonly deps: DispatcherDeps, private readonly halt: (chain: ActiveChain, error: Notice) => void) {}

  async guard(chain: ActiveChain): Promise<boolean> {
    const current = chain.current
    if (current?.sessionId == null || current.starting !== undefined) return true
    let held = current.limit?.overage
    if (held?.stopped && current.limit?.acted === null) return true
    const evidence = this.deps.overage?.(current.task)
    if (held === undefined || current.limit?.acted !== null) {
      const session = evidence?.session
      if (session === undefined || session.sessionId !== current.sessionId) return true
      if (current.resumedAt !== undefined && Date.parse(session.limit.at) <= Date.parse(current.resumedAt)) return true
      const reset = this.deps.limitResetAfter(session.account, session.limit.at, session.limit.text)
      held = { session, stopped: false }
      current.limit = { ...holdOf(session, this.deps.accountAt(session.account, session.limit.at), reset), overage: held }
      this.deps.save(this.state)
    }
    if (held.stopped) return true
    try {
      if (this.deps.midTurn(current.task)) await this.deps.stop(held.session)
      held.stopped = true
      this.deps.save(this.state)
      const source = evidence?.session.sessionId === held.session.sessionId && evidence.session.limit.at === held.session.limit.at ? evidence.source : undefined
      const reason = source !== undefined && source !== 'claude-usage' ? 'paid usage detected' : 'included allowance exhausted; paid usage possible, not confirmed'
      this.deps.log(`chain: ${current.task}: ${reason} on account ${held.session.account}; session ${held.session.sessionId} stopped; waiting for included allowance`)
      return true
    } catch (error) {
      this.halt(chain, noticeOf(error))
      return false
    }
  }
}
