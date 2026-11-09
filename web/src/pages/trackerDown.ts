import { BUILTIN } from '../../../src/builtin/model.js'
import type { TrackerHealth, TrackerView } from '../../../src/tracker/health.js'
import { say, t } from '../i18n/index.js'
import { type NoticeFix, noticeFixOf, PROFILES } from './noticeFix.js'
import { trackerReason } from './status.js'

/** Why a tracker is down, in the page's language: its error's notice, or what the error means; `null` — it is not down. */
export function trackerDownText(health: TrackerHealth): string | null {
  const reason = trackerReason(health)
  if (reason === null) return null
  return typeof reason === 'string' ? t.statusPage.trackerProblem[reason] : say(reason)
}

/** `detail` — the tracker's error for a tip, where `why` is not the error itself; `fix` — the place it is fixed at. */
export interface Unread {
  why: string
  detail: string | null
  fix: NoticeFix | null
}

/**
 * Why a project's tasks stay unread while its tracker is down (BTN-788), for its page and its home card; `null` — the
 * tracker is not down. The built-in tracker is the state database: no error text, no profile to open.
 */
export function unreadWhy(tracker: TrackerView | undefined): Unread | null {
  const why = tracker === undefined ? null : trackerDownText(tracker.health)
  if (tracker === undefined || why === null) return null
  if (tracker.kind === BUILTIN) return { why: t.system.lost, detail: null, fix: noticeFixOf(tracker.health.notice) }
  return { why, detail: tracker.health.notice === undefined ? tracker.health.error : null, fix: noticeFixOf(tracker.health.notice) ?? PROFILES }
}
