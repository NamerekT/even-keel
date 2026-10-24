import type { EvenKeelState } from '../../../src/state.js'
import type { TrackerView } from '../../../src/tracker/health.js'
import type { Check } from '../layout/system.js'

/** The trackers are read every 30 seconds: a reader not read for longer than this is marked on its connection's card. */
export const STALE_READ_MS = 3 * 60_000

/** The checks that warn or fail, the failing first, each in the page's order. */
export function problemsOf(checks: Check[]): Check[] {
  return [...checks.filter((check) => check.level === 'error'), ...checks.filter((check) => check.level === 'warn')]
}

/**
 * The readers of a live connection whose tasks were not read for a while, by id, with when they last were (`null` —
 * never). While the connection is down or not up yet its head says so, and no reader is marked.
 */
export function staleReaders(tracker: TrackerView, now: Date): Map<string, string | null> {
  if (tracker.health.state !== 'live') return new Map()
  const stale = tracker.projects.flatMap((reader): [string, string | null][] => {
    const read = tracker.readAt[reader]
    if (read === undefined) return [[reader, null]]
    return now.getTime() - Date.parse(read) > STALE_READ_MS ? [[reader, read]] : []
  })
  return new Map(stale)
}

/** The projects whose read reads the connection's readers anew: a project itself, a task feed's project for a feed. */
export function refreshedProjects(state: Pick<EvenKeelState, 'projects' | 'config'>, tracker: TrackerView): string[] {
  const owners = tracker.projects.map((reader) => {
    if (state.projects.includes(reader)) return reader
    return Object.entries(state.config.feeds).find(([, feeds]) => feeds.some((feed) => feed.id === reader))?.[0]
  })
  return [...new Set(owners.filter((owner) => owner !== undefined))]
}

export type TrackerProblem = 'denied' | 'timeout' | 'unreachable' | 'other'

/** What a tracker's error means to a person; the error itself goes into a tip. */
export function trackerProblem(error: string): TrackerProblem {
  if (/\b(401|403)\b|unauthori[sz]ed|forbidden|invalid (token|credentials|api key)|bad credentials/i.test(error)) return 'denied'
  if (/timed? ?out|timeout|ETIMEDOUT/i.test(error)) return 'timeout'
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|EHOSTUNREACH|fetch failed|getaddrinfo|socket hang up/i.test(error)) return 'unreachable'
  return 'other'
}
