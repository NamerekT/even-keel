import type { AccountEntry } from '../account/model.js'
import type { HandoffSession, LimitedSession } from '../chain/relay.js'
import { isLive, type AgentEntry } from '../sessions/agents.js'
import { OVERAGE_LIMIT_TEXT, overageLimit } from './overage.js'

/** Account readings may be shared, but liveness and the stop target always belong to the chain's session. */
export function overageSession(session: HandoffSession | undefined, agent: AgentEntry | undefined, account: AccountEntry | undefined, now: Date): LimitedSession | undefined {
  if (session === undefined || agent === undefined || account === undefined || agent.sessionId !== session.sessionId || account.key !== session.account) return undefined
  const at = overageLimit({ ...account, working: isLive(agent) && agent.status === 'busy' }, now)
  return at === null ? undefined : { ...session, limit: { at, text: OVERAGE_LIMIT_TEXT } }
}
