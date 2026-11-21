import type { AccountEntry } from '../../../src/account/model.js'
import type { LimitSpent } from '../../../src/chain/limitNotice.js'
import type { LimitHold } from '../../../src/chain/relay.js'
import { notice, type Notice } from '../../../src/notice/notice.js'
import type { SessionView } from '../../../src/state.js'
import { say } from '../i18n/index.js'
import { limitPlan } from './sessionStatus.js'

export interface LimitRefusal { notice: Notice; at: string }
export interface LimitMessage { kind: 'refusal' | 'agent' | 'plan'; text: string; at: string }

/** Why "New session" is held while the task's account has its limit spent (BTN-1359); `null` — a window is free. */
export function spentHeld(spent: LimitSpent | undefined): string | null {
  return spent === undefined ? null : say(notice('chain.limitHeld', spent))
}

/** The newest of the command refusal, the continuation plan and the agent's report; the older ones repeat it or the activity feed (BTN-579). */
export function limitMessage(hold: LimitHold | null, now: Date, session: SessionView, accounts: readonly AccountEntry[], refusal: LimitRefusal | null): LimitMessage | undefined {
  const messages: LimitMessage[] = []
  if (refusal !== null) messages.push({ kind: 'refusal', text: say(refusal.notice), at: refusal.at })
  if (hold !== null) messages.push({ kind: 'plan', text: limitPlan(hold, now, session, accounts), at: hold.at })
  const report = session.apiErrorNotice === undefined ? session.apiError : say(session.apiErrorNotice)
  if (report !== null && (hold !== null || ['limit', 'credit', 'spend'].includes(session.apiErrorKind ?? ''))) {
    messages.push({ kind: 'agent', text: report, at: session.lastActivityAt ?? hold?.at ?? session.startedAt })
  }
  return messages.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]
}
