import { useEffect, useRef, type RefObject } from 'react'
import { redoDraft, undoDraft, type DraftPart } from '../pages/settingsStore.js'
import { comboOf, DRAFT_KEYS, draftCombos, isMac, type DraftKey, type KeyPress } from './combo.js'

interface KeyTarget {
  tagName?: string
  type?: string
  isContentEditable?: boolean
}

/** Inputs that hold no typed text, so Ctrl+Z on them steps the draft instead of the browser's undo. */
const NOT_TEXT = ['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image']

/** Whether the key goes to a field the browser keeps its own undo of the typed text for. */
function typesText(target: KeyTarget | null): boolean {
  if (target === null) return false
  if (target.isContentEditable === true || target.tagName === 'TEXTAREA') return true
  return target.tagName === 'INPUT' && !NOT_TEXT.includes(target.type ?? 'text')
}

/**
 * What a key press asks of a form with a draft (BTN-1064). Ctrl+S saves from anywhere, a text field included; Ctrl+Z
 * and redo leave a text field to the browser's own undo; an IME composing takes nothing.
 */
export function draftKeyOf(event: KeyPress & { isComposing: boolean; target: EventTarget | null }, mac: boolean): DraftKey | null {
  if (event.isComposing) return null
  const combo = comboOf(event, mac)
  const key = DRAFT_KEYS.find((each) => combo !== null && draftCombos(each, mac).includes(combo)) ?? null
  return key !== 'save' && typesText(event.target as KeyTarget | null) ? null : key
}

interface Placed {
  contains(other: unknown): boolean
  closest(selector: string): unknown
}

/**
 * The form a draft key goes to: under an open dialog the one in it — a tracker window over the settings panel saves
 * the window — else the latest form outside any dialog; `undefined` — none, as under a dialog of another kind.
 */
export function draftTargetOf<T extends { element: Placed | null }>(targets: readonly T[], topDialog: Placed | null): T | undefined {
  const placed = targets.filter((each) => each.element !== null)
  if (topDialog !== null) return placed.findLast((each) => each.element === topDialog || topDialog.contains(each.element))
  return placed.findLast((each) => each.element!.closest('dialog') === null)
}

/** What a form with a draft does on its keys; read at the press, so the latest render's values hold. */
export interface DraftKeys {
  /** Whether a save would go now: something changed, nothing is being sent, no field is wrong. */
  canSave: boolean
  /** The same as the form's save button. */
  save: () => void
  /** The drafts and fields of the open section that Ctrl+Z steps in. */
  parts: readonly DraftPart[]
}

interface Registered<E extends Placed = Element> {
  element: E | null
  keys: { current: DraftKeys }
}

type DraftPress = KeyPress & { isComposing: boolean; target: EventTarget | null; repeat: boolean; preventDefault(): void }

/** A key press on a page with forms: done by the form it goes to; Ctrl+S never opens the browser's "Save page" over one. */
export function pressDraftKey<E extends Placed>(event: DraftPress, forms: readonly Registered<E>[], topDialog: E | null, mac: boolean): void {
  const key = draftKeyOf(event, mac)
  if (key === null) return
  const target = draftTargetOf(forms, topDialog)
  if (key === 'save') {
    event.preventDefault()
    if (!event.repeat && target?.keys.current.canSave === true) target.keys.current.save()
    return
  }
  if (target !== undefined && (key === 'undo' ? undoDraft : redoDraft)(target.keys.current.parts)) event.preventDefault()
}

const registered: Registered[] = []

const onKey = (event: KeyboardEvent) =>
  pressDraftKey(event, registered, [...document.querySelectorAll('dialog[open]')].at(-1) ?? null, isMac(navigator as Navigator & { userAgentData?: { platform?: string } }))

/**
 * Ctrl+S, Ctrl+Z and Ctrl+Shift+Z for the form `element` holds (BTN-1064) while it is on the page. One listener serves
 * every form; a page with none leaves the keys to the browser.
 */
export function useDraftKeys(element: RefObject<Element | null>, keys: DraftKeys): void {
  const latest = useRef(keys)
  latest.current = keys
  useEffect(() => {
    const entry: Registered = {
      get element() {
        return element.current
      },
      keys: latest,
    }
    if (registered.length === 0) window.addEventListener('keydown', onKey)
    registered.push(entry)
    return () => {
      registered.splice(registered.indexOf(entry), 1)
      if (registered.length === 0) window.removeEventListener('keydown', onKey)
    }
  }, [element])
}
