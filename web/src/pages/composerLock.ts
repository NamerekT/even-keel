import type { SessionView } from '../../../src/state.js'
import { t } from '../i18n/index.js'

export function lockReason(session: Pick<SessionView, 'lamp' | 'waitingFor' | 'asking'>, aside: boolean): string | null {
  if (session.lamp === 'working') return t.session.chat.working
  if (session.lamp === 'finished') return t.session.chat.finished
  if (session.lamp === 'limit') return t.session.chat.limit
  if (session.waitingFor !== null && !session.asking) return t.session.chat.dialog(session.waitingFor)
  return aside ? t.session.chat.aside : null
}
