import { useEffect, useSyncExternalStore } from 'react'
import { edited, rebase, settled, type Draft, type Same, type Values } from './settingsDraft.js'
import { baseMoved, EMPTY_HISTORY, historyAfter, redone, undone, type History, type Step } from './settingsHistory.js'

// While the page is open: closing the panel or going to another page keeps them, a reload drops them.
const drafts = new Map<string, Draft>()
const histories = new Map<string, History>()
const tabs = new Map<string, string>()
const listeners = new Set<() => void>()
let seq = 0

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}
const notify = () => listeners.forEach((listener) => listener())

/** The draft of a settings form, against the file as it is now. */
export type SetDraft = (next: Draft | ((before: Draft) => Draft)) => void

/** Every edit of a form goes through here, so its history needs nothing from the form (BTN-1064). */
export function writeDraft(scope: string, before: Draft, next: Draft) {
  histories.set(scope, historyAfter(histories.get(scope) ?? EMPTY_HISTORY, before, next, ++seq))
  drafts.set(scope, next)
  notify()
}

/** The draft of a scope as the store holds it; `undefined` — never edited. */
export const storedDraft = (scope: string): Draft | undefined => drafts.get(scope)

export function useDraft(scope: string, saved: Values | undefined, same: Same): [Draft | undefined, SetDraft] {
  const stored = useSyncExternalStore(subscribe, () => drafts.get(scope))
  const set: SetDraft = (next) => {
    const before = drafts.get(scope) ?? rebase(undefined, saved!, same)
    writeDraft(scope, before, typeof next === 'function' ? next(before) : next)
  }
  const next = saved === undefined ? undefined : settled(stored, saved, same)
  useEffect(() => {
    if (next === undefined) return
    if (stored !== undefined && baseMoved(stored, next)) histories.delete(scope)
    drafts.set(scope, next)
  })
  return [saved === undefined ? undefined : (next ?? rebase(stored, saved, same)), set]
}

/** A draft a form's Ctrl+Z steps in, and the fields of its open section; no `keys` — all of them. */
export interface DraftPart {
  scope: string
  keys?: readonly string[]
}

/** Steps back the latest edit of the parts' sections, the latest across the parts; `false` — nothing to step back. */
export const undoDraft = (parts: readonly DraftPart[]) => stepDraft(parts, undone, 'before')

/** Makes again the latest edit Ctrl+Z stepped back in the parts' sections; `false` — none. */
export const redoDraft = (parts: readonly DraftPart[]) => stepDraft(parts, redone, 'after')

function stepDraft(parts: readonly DraftPart[], move: (history: History, keys: readonly string[] | null, seq: number) => [Step, History] | null, side: 'before' | 'after'): boolean {
  const moved = ++seq
  const found = parts.flatMap((part) => {
    const each = move(histories.get(part.scope) ?? EMPTY_HISTORY, part.keys ?? null, moved)
    return each === null ? [] : [{ scope: part.scope, step: each[0], history: each[1] }]
  })
  const latest = found.reduce<(typeof found)[number] | undefined>((best, each) => (best === undefined || each.step.seq > best.step.seq ? each : best), undefined)
  const draft = latest === undefined ? undefined : drafts.get(latest.scope)
  if (latest === undefined || draft === undefined) return false
  const { scope, step, history } = latest
  histories.set(scope, history)
  drafts.set(scope, Object.entries(step[side]).reduce((each, [key, value]) => edited(each, key, value), draft))
  notify()
  return true
}

/** The scope of Even Keel's own settings page. */
export const SHARED_SCOPE = 'shared'

/** The scope of a project's settings panel. */
export const projectScope = (project: string) => `project:${project}`

/**
 * The scope of the tab a source's window opens on when a link asks for it; `''` — the window is not asked for. The
 * reader is the project itself for its main tracker's window, or a feed's id for that feed's.
 */
export const sourceScope = (reader: string) => `source:${reader}`

/** The address hash of a project page that opens its settings panel; a task id never equals it. */
export const SETTINGS_HASH = 'settings'

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
