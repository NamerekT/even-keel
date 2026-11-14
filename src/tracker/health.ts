import type { Notice } from '../notice/notice.js'

export type TrackerLinkState = 'off' | 'connecting' | 'live' | 'down'

export interface TrackerHealth {
  state: TrackerLinkState
  lastOkAt: string | null
  error: string | null
  /** The error's notice where it has one (`NoticeError`): the page says it in its own language, with its fix (BTN-788). */
  notice?: Notice
}

export interface TrackerView {
  /** The id of the profile it runs on; `none:<kind>` for a tracker whose projects have no profile (`noProfile`). */
  name: string
  /** The adapter's name: `huly`, `github`, `linear`. */
  kind: string
  /** The profile's name; the adapter's title without a profile. */
  title: string
  projects: string[]
  /** The connected adapter can move a backlog task to `ToDo`. */
  ready: boolean
  /** The connected adapter can edit task labels. */
  relabel?: boolean
  /** The connected adapter can move a ready or started task back to the backlog status. */
  unready?: boolean
  health: TrackerHealth
  /** Its profile is turned off (BTN-830): nothing of its host is reached, its projects' tasks are not read. */
  disabled?: true
  /** When each reader's tasks were last read in full, by its id (a project's, or a feed's); one not read yet has none. */
  readAt: Record<string, string>
  /**
   * When the link last turned `live` (BTN-830): a reader whose `readAt` is older was read before the tracker went down or
   * the service started, and a chain does not start by that list.
   */
  liveSince?: string
  /** Refused closes of merged tasks, by reader; retried on the next full read. In memory only. */
  completionFailures?: Record<string, Notice[]>
  /**
   * By reader, rechecked on every full read: the tracker says anyone may open a task there (`isPublic`) and the reader
   * takes tasks without a required label, so an outsider's task waits for "Into the chain" (BTN-1134). A reader of a
   * tracker without `isPublic` has none; a failed check keeps the last answer.
   */
  openToAll?: Record<string, boolean>
  /** Status moves on a task's start or pull request that did not go through (BTN-554), by reader. In memory only. */
  moveFailures?: Record<string, Notice[]>
}

/** The reader's last full read is since the link last turned live, and the link is live: a chain may start by it (BTN-830). */
export function readFresh(view: TrackerView, reader: string): boolean {
  const readAt = view.readAt[reader]
  return view.health.state === 'live' && readAt !== undefined && (view.liveSince === undefined || readAt >= view.liveSince)
}

export const worthBroadcast = (before: TrackerHealth, after: TrackerHealth): boolean =>
  before.state !== after.state || before.error !== after.error || before.lastOkAt === null
