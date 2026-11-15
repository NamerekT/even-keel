import { BUILTIN } from '../../../src/builtin/model.js'
import type { EvenKeelState } from '../../../src/state.js'
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

export type FeedsState = Pick<EvenKeelState, 'trackers' | 'config'>

/**
 * The project and its feeds whose tasks are read but whose vocabulary is refused (EKR-106), by their keys, one entry a
 * reason: their sessions get no line of the chain's roles for them and the tasks tools refuse their creates and edits.
 */
export function termsRefused(state: FeedsState & Pick<EvenKeelState, 'projectKeys'>, project: string): { keys: string[]; why: string; fix: NoticeFix }[] {
  const readers = [{ id: project, key: state.projectKeys[project] ?? project }, ...(state.config.feeds[project] ?? []).map((feed) => ({ id: feed.id, key: feed.key }))]
  const found = new Map<string, { keys: string[]; why: string; fix: NoticeFix }>()
  for (const reader of readers) {
    const refused = state.trackers.find((view) => view.projects.includes(reader.id))?.termsRefused?.[reader.id]
    if (refused === undefined) continue
    const mark = JSON.stringify(refused)
    const entry = found.get(mark) ?? { keys: [], why: say(refused), fix: noticeFixOf(refused) ?? PROFILES }
    entry.keys.push(reader.key)
    found.set(mark, entry)
  }
  return [...found.values()]
}

/**
 * The project's feeds left unread by a down tracker (BTN-1210), by their keys, one entry a tracker. A feed on the
 * project's own tracker is left out: the project's own line already says why.
 */
export function feedsUnread(state: FeedsState, project: string): { feeds: string[]; unread: Unread }[] {
  const own = state.trackers.find((view) => view.projects.includes(project))
  const found = new Map<TrackerView, { feeds: string[]; unread: Unread }>()
  for (const feed of state.config.feeds[project] ?? []) {
    const view = state.trackers.find((each) => each.projects.includes(feed.id))
    if (view === undefined || view === own) continue
    const entry = found.get(view)
    if (entry !== undefined) {
      entry.feeds.push(feed.key)
      continue
    }
    const unread = unreadWhy(view)
    if (unread !== null) found.set(view, { feeds: [feed.key], unread })
  }
  return [...found.values()]
}
