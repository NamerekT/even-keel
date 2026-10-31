import type { AccountEntry } from '../../../src/account/model.js'
import type { LimitHold } from '../../../src/chain/relay.js'
import type { SessionView } from '../../../src/state.js'
import { notice } from '../../../src/notice/notice.js'
import { needsReply } from '../completion.js'
import { spendsByKey } from '../layout/accountParts.js'
import { formatMoment } from '../format.js'
import { say, t } from '../i18n/index.js'

export function limitPlan(hold: LimitHold, now: Date, session: SessionView, accounts: readonly AccountEntry[]): string {
  if (session.apiErrorKind === 'transient' && hold.resetsAt !== null) return say(notice('session.transientRetry', { at: formatMoment(hold.resetsAt, now) }))
  if (session.apiErrorKind === 'spend') return t.session.spendWait(hold.resetsAt === null ? null : formatMoment(hold.resetsAt, now))
  const entry = accounts.find((each) => each.key === session.account)
  if (hold.resetsAt === null) return entry !== undefined && spendsByKey(entry) ? t.session.creditOut : t.session.limitUnknown
  const at = formatMoment(hold.resetsAt, now)
  return hold.then === 'resume' ? t.session.limitResume(at) : t.session.limitRelay(at)
}

export function sessionStatus(session: SessionView, refused = false): string {
  if (refused && !needsReply(session)) return say(notice('tracker.closePending', {}))
  if (session.lamp === 'waiting' && session.apiErrorKind === 'transient') return say(notice('session.transient', {}))
  if (session.lamp === 'limit' && session.apiErrorKind === 'spend') return t.session.spendEmpty
  return session.lamp === 'limit' && session.apiErrorKind === 'credit' ? t.session.creditEmpty : t.lamp[session.lamp]
}
