import { useEffect, useSyncExternalStore } from 'react'
import type { EventEntry, EventPlace } from '../../../src/event-log/model.js'
import type { EvenKeelState } from '../../../src/state.js'
import { BACKLOG_HASH } from '../pages/BacklogPanel.js'
import { CI_HASH } from '../pages/CiChip.js'
import { SETTINGS_HASH } from '../pages/settingsStore.js'
import { projectPath } from '../state.js'

/** The page of the log (`EventLogPage`). */
export const LOG_PATH = '/log'

/** The page an entry's "Open" goes to; null when it has nowhere to point. */
export type EventPath = { pathname: string; search?: string; hash?: string }

/**
 * A question opens its row, a red main the CI chip, a task's work its backlog or its card, a setting the settings, a
 * package problem the project's column on /tools, unread limits the accounts.
 */
export function placePath(place: EventPlace | null, state: Pick<EvenKeelState, 'ci' | 'projects'>): EventPath | null {
  if (place === null) return null
  if (place.view === 'accounts') return { pathname: '/accounts' }
  if (place.project === null) return { pathname: place.view === 'settings' ? '/settings' : '/' }
  if (!state.projects.includes(place.project)) return null
  if (place.view === 'packages') return { pathname: '/tools', search: `?projects=${encodeURIComponent(place.project)}` }
  const pathname = projectPath(place.project)
  if (place.view === 'settings') return { pathname, hash: SETTINGS_HASH }
  if (place.view === 'ask') return { pathname, hash: place.task }
  if (place.view === 'backlog') return { pathname, hash: BACKLOG_HASH }
  if (place.view === 'task') return { pathname, search: `?task=${encodeURIComponent(place.task)}` }
  if (place.view === 'ci' && state.ci[place.project] !== undefined) return { pathname, hash: CI_HASH }
  return { pathname }
}

const idOf = (entry: EventEntry) => Number(entry.id)

/** The newest id of the log, 0 for an empty one. */
export function lastId(entries: readonly EventEntry[]): number {
  return entries.reduce((most, entry) => Math.max(most, idOf(entry)), 0)
}

/** The entries written after `seen` that a person must notice: warnings and errors; info goes only to the log. */
export function freshAlerts(entries: readonly EventEntry[], seen: number): EventEntry[] {
  return entries.filter((entry) => entry.level !== 'info' && idOf(entry) > seen)
}

/** Toasts at once on the screen; an older one gives way to a newer, it stays in the log. */
export const TOAST_LIMIT = 3

/** The toasts shown after `fresh` came: the newest `TOAST_LIMIT`, newest last. */
export function withFresh(shown: readonly EventEntry[], fresh: readonly EventEntry[]): EventEntry[] {
  return [...shown, ...fresh].slice(-TOAST_LIMIT)
}

const READ_KEY = 'even-keel.eventLog.read'
const listeners = new Set<() => void>()

/** The id of the last entry read in this browser; null before the page first saw the log. */
export function readMark(): number | null {
  try {
    const value = localStorage.getItem(READ_KEY)
    return value === null ? null : Number(value) || 0
  } catch {
    return null
  }
}

/** Marks the log read up to `id`; never moves the mark back. */
export function markRead(id: number): void {
  if ((readMark() ?? -1) >= id) return
  try {
    localStorage.setItem(READ_KEY, String(id))
  } catch {}
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const storage = (event: StorageEvent) => event.key === READ_KEY && listener()
  window.addEventListener('storage', storage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', storage)
  }
}

/** The read mark, live across the page's parts and its other tabs. */
export function useReadMark(): number | null {
  return useSyncExternalStore(subscribe, readMark, () => null)
}

/**
 * Sets the read mark of a browser that never saw the log to the log's newest entry, so a first visit does not count
 * the whole history. `EventToasts` calls it on every page: on a narrow screen "Log" mounts only with the opened menu,
 * and a mark set then would swallow what came since the page opened.
 */
export function useFirstReadMark(entries: readonly EventEntry[] | undefined): number | null {
  const mark = useReadMark()
  const loaded = entries !== undefined
  useEffect(() => {
    if (loaded && mark === null) markRead(lastId(entries))
  }, [loaded, mark, entries])
  return mark
}

/** The unread warnings and errors of the log and whether one is an error. */
export function useUnread(entries: readonly EventEntry[] | undefined): { count: number; error: boolean } {
  const mark = useFirstReadMark(entries)
  if (entries === undefined || mark === null) return { count: 0, error: false }
  const unread = freshAlerts(entries, mark)
  return { count: unread.length, error: unread.some((entry) => entry.level === 'error') }
}
