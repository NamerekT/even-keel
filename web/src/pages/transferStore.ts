import { useSyncExternalStore } from 'react'

/** A transfer's report to open on its project's Tracker tab, set by the event log's link (BTN-1291). */
const pending = new Map<string, string>()
const listeners = new Set<() => void>()

export function openReport(project: string, id: string): void {
  pending.set(project, id)
  for (const listener of listeners) listener()
}

/** Takes the report waiting for the project, once. */
export function takeReport(project: string): string | undefined {
  const id = pending.get(project)
  pending.delete(project)
  return id
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The report waiting for the project, live. */
export function usePendingReport(project: string): string | undefined {
  return useSyncExternalStore(subscribe, () => pending.get(project))
}
