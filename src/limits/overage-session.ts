import type { AccountEntry } from '../account/model.js'
import type { HandoffSession, LimitedSession } from '../chain/relay.js'
import { isLive, type AgentEntry } from '../sessions/agents.js'
import { OVERAGE_LIMIT_TEXT, overageLimit, type OverageLimit } from './overage.js'

export interface OverageSession {
  session: LimitedSession
  source: OverageLimit['source']
}

/** Account readings may be shared, but liveness and the stop target always belong to the chain's session. */
export function overageSession(session: HandoffSession | undefined, agent: AgentEntry | undefined, account: AccountEntry | undefined, now: Date): OverageSession | undefined {
  if (session === undefined || agent === undefined || account === undefined || agent.sessionId !== session.sessionId || account.key !== session.account) return undefined
  const evidence = overageLimit({ ...account, working: isLive(agent) && agent.status === 'busy' }, now)
  return evidence === null ? undefined : { source: evidence.source, session: { ...session, limit: { at: evidence.at, text: OVERAGE_LIMIT_TEXT } } }
}
