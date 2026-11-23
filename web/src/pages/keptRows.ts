import { useEffect, useReducer, useState } from 'react'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import type { LiveActions } from '../live/actions.js'
import { useLive } from '../live/context.js'

/** The rows last loaded per route and project, for as long as the page lives. */
const kept = new Map<string, unknown[]>()
/** A load under way per route and project: a tab that mounts while its window's early load runs takes that answer. */
const loading = new Map<string, Promise<unknown[]>>()

const keyOf = (route: string, project: string) => `${route}\n${project}`

/**
 * Loads a project's rows into the kept ones, sharing a load already under way unless `fresh` (after an edit, whose
 * change a load started before it may miss); only the last load started writes, and a failure keeps the last rows.
 */
export function keepRows<T>(query: LiveActions['query'], route: string, project: string, fresh = false): Promise<T[]> {
  const key = keyOf(route, project)
  const running = loading.get(key)
  if (running !== undefined && !fresh) return running as Promise<T[]>
  const next: Promise<unknown[]> = query<T[]>(route, { project })
    .then((rows) => {
      if (loading.get(key) === next) kept.set(key, rows)
      return rows
    })
    .finally(() => {
      if (loading.get(key) === next) loading.delete(key)
    })
  loading.set(key, next)
  return next as Promise<T[]>
}

/**
 * A project's rows from a `query` route that outlive the component (BTN-1499): a tab opened again shows the last rows
 * at once and refreshes them behind, so its window does not shrink to "Loading…" and grow back. `load` asks anew.
 */
export function useKeptRows<T>(route: string, project: string): { rows: T[] | null; failure: Notice | null; load: () => Promise<void> } {
  const { query } = useLive()
  const key = keyOf(route, project)
  const [, loaded] = useReducer((count: number) => count + 1, 0)
  const [failure, setFailure] = useState<Notice | null>(null)

  const load = async (fresh = true) => {
    try {
      await keepRows<T>(query, route, project, fresh)
      setFailure(null)
    } catch (reason) {
      setFailure(noticeOf(reason))
    }
    loaded()
  }
  useEffect(() => void load(false), [key])

  return { rows: (kept.get(key) as T[] | undefined) ?? null, failure, load: () => load() }
}
