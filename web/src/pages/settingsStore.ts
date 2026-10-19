import { useSyncExternalStore } from 'react'
import { rebase, type Draft, type Same, type Values } from './settingsDraft.js'

// While the page is open: closing the panel or going to another page keeps them, a reload drops them.
const drafts = new Map<string, Draft>()
const tabs = new Map<string, string>()
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}
const notify = () => listeners.forEach((listener) => listener())

/** The draft of a settings form, against the file as it is now. */
export function useDraft(scope: string, saved: Values | undefined, same: Same): [Draft | undefined, (next: Draft) => void] {
  const stored = useSyncExternalStore(subscribe, () => drafts.get(scope))
  const set = (next: Draft) => {
    drafts.set(scope, next)
    notify()
  }
  return [saved === undefined ? undefined : rebase(stored, saved, same), set]
}

/** The scope of Even Keel's own settings page. */
export const SHARED_SCOPE = 'shared'

/** Opens a tab of a settings form before going there, e.g. from a link on another page. */
export function openTab(scope: string, tab: string) {
  tabs.set(scope, tab)
  notify()
}

/** The open tab of a settings form; it stays when the form closes. */
export function useTab<T extends string>(scope: string, first: T): [T, (tab: T) => void] {
  const open = useSyncExternalStore(subscribe, () => tabs.get(scope)) as T | undefined
  return [open ?? first, (tab: T) => openTab(scope, tab)]
}
