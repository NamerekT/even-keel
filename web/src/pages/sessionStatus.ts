import type { AccountEntry } from '../../../src/account/model.js'
import type { LimitHold } from '../../../src/chain/relay.js'
import type { BackgroundWait } from '../../../src/sessions/agents.js'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import type { SessionView } from '../../../src/state.js'
import type { BlockLamp } from '../state.js'
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
  if (session.lamp === 'working' && session.background != null) return t.session.background.status
  if (session.lamp === 'waiting' && session.apiErrorKind === 'transient') return say(notice('session.transient', {}))
  if (session.lamp === 'limit' && session.apiErrorKind === 'spend') return t.session.spendEmpty
  return session.lamp === 'limit' && session.apiErrorKind === 'credit' ? t.session.creditEmpty : t.lamp[session.lamp]
}

/** The tip of a card's lamp where the lamp's own word says too little; `undefined` — its own word. */
export function lampLabel(lamp: BlockLamp, session: SessionView | null | undefined, now: Date): string | undefined {
  if (session == null) return undefined
  if (lamp === 'waiting' && session.apiErrorKind === 'transient') return sessionStatus(session)
  if (lamp === 'working' && session.background != null) return `${t.session.background.status}\n${backgroundTip(session.background, now)}`
  return undefined
}

/** The line of a card's action screen: the wait for a background command over the ended turn's last action. */
export function cardAction(session: SessionView): FeedLine | null {
  if (session.lamp !== 'working' || session.background == null) return session.action
  return { at: session.lastActivityAt ?? '', kind: 'text', text: t.session.chat.background(session.background.command) }
}

/** The details of a session's wait for its background command: the command and when Even Keel takes it for hung. */
export function backgroundTip(wait: BackgroundWait, now: Date): string {
  const strings = t.session.background
  const hang = wait.hangsAt === null ? null : Date.parse(wait.hangsAt) <= now.getTime() ? strings.hung(formatMoment(wait.hangsAt, now)) : strings.hangs(formatMoment(wait.hangsAt, now))
  return [wait.command === null ? null : strings.command(wait.command), hang ?? strings.unknown].filter((part) => part !== null).join('\n')
}
