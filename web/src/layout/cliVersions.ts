import type { CliVersionView } from '../../../src/state.js'
import { t } from '../i18n/index.js'

/** The folded line of the CLI version banner (BTN-349): the one CLI with its versions, or how many there are. */
export function cliSummary(shown: CliVersionView[]): string {
  const [only] = shown
  if (only === undefined || shown.length > 1) return t.banner.cliMany(shown.length)
  const { notice, agent, installed, checked } = only
  if (notice.code === 'agent.daemonVersion') return t.banner.cliDaemon(notice.params.title, notice.params.account, installed, checked)
  return t.banner.cliOne(notice.code === 'agent.uncheckedVersion' ? notice.params.title : agent, installed, checked)
}
