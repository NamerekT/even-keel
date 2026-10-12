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

/** The open tab of a settings form; it stays when the form closes. */
export function useTab<T extends string>(scope: string, first: T): [T, (tab: T) => void] {
  const open = useSyncExternalStore(subscribe, () => tabs.get(scope)) as T | undefined
  const set = (tab: T) => {
    tabs.set(scope, tab)
    notify()
  }
  return [open ?? first, set]
}
