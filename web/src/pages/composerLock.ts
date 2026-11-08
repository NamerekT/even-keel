import type { PackagesView, SessionView } from '../../../src/state.js'
import { t } from '../i18n/index.js'

export function lockReason(session: Pick<SessionView, 'lamp' | 'waitingFor' | 'asking'>, aside: boolean): string | null {
  if (session.lamp === 'working') return t.session.chat.working
  if (session.lamp === 'finished') return t.session.chat.finished
  if (session.lamp === 'limit') return t.session.chat.limit
  if (session.waitingFor !== null && !session.asking) return t.session.chat.dialog(session.waitingFor)
  return aside ? t.session.chat.aside : null
}

/**
 * The checkpoint plugin a working session's chat offers to add to the project's packages, so that later messages reach a
 * session mid-turn; `null` once the project has it on, or when the checkout has no marketplace of its own to add it from.
 */
export function checkpointOffer(packages: PackagesView | null, project: string): string | null {
  const own = packages?.marketplace?.name
  if (packages === null || own === undefined) return null
  const name = `checkpoint@${own}`
  return packages.projects[project]?.cells[name]?.enabled === true ? null : name
}
