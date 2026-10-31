import type { Notice } from '../notice/notice.js'

export type TrackerLinkState = 'off' | 'connecting' | 'live' | 'down'

export interface TrackerHealth {
  state: TrackerLinkState
  lastOkAt: string | null
  error: string | null
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
  /** When each reader's tasks were last read in full, by its id (a project's, or a feed's); one not read yet has none. */
  readAt: Record<string, string>
  /** Refused closes of merged tasks, by reader; retried on the next full read. In memory only. */
  completionFailures?: Record<string, Notice[]>
  /** Status moves on a task's start or pull request that did not go through (BTN-554), by reader. In memory only. */
  moveFailures?: Record<string, Notice[]>
}

export const worthBroadcast = (before: TrackerHealth, after: TrackerHealth): boolean =>
  before.state !== after.state || before.error !== after.error || before.lastOkAt === null
