import type { TrackerHealth } from '../../../src/tracker/health.js'
import { say, t } from '../i18n/index.js'
import { trackerReason } from './status.js'

/** Why a tracker is down, in the page's language: its error's notice, or what the error means; `null` — it is not down. */
export function trackerDownText(health: TrackerHealth): string | null {
  const reason = trackerReason(health)
  if (reason === null) return null
  return typeof reason === 'string' ? t.statusPage.trackerProblem[reason] : say(reason)
}
