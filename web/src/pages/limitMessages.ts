import type { AccountEntry } from '../../../src/account/model.js'
import type { LimitHold } from '../../../src/chain/relay.js'
import type { Notice } from '../../../src/notice/notice.js'
import type { SessionView } from '../../../src/state.js'
import { say } from '../i18n/index.js'
import { limitPlan } from './sessionStatus.js'

export interface LimitRefusal { notice: Notice; at: string }
export interface LimitMessage { kind: 'refusal' | 'agent' | 'plan'; text: string; at: string }

export function limitMessages(hold: LimitHold | null, now: Date, session: SessionView, accounts: readonly AccountEntry[], refusal: LimitRefusal | null): LimitMessage[] {
  const messages: LimitMessage[] = []
  if (refusal !== null) messages.push({ kind: 'refusal', text: say(refusal.notice), at: refusal.at })
  if (hold !== null) messages.push({ kind: 'plan', text: limitPlan(hold, now, session, accounts), at: hold.at })
  const report = session.apiErrorNotice === undefined ? session.apiError : say(session.apiErrorNotice)
  if (report !== null && (hold !== null || ['limit', 'credit', 'spend'].includes(session.apiErrorKind ?? ''))) {
    messages.push({ kind: 'agent', text: report, at: session.lastActivityAt ?? hold?.at ?? session.startedAt })
  }
  return messages.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).filter((each, index, all) => all.findIndex((other) => other.text === each.text) === index)
}
