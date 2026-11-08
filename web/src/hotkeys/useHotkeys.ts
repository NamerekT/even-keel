import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { BROWSER_ID, resolvedHotkeys, type HotkeyAction, type HotkeyBindings } from '../../../src/hotkeys.js'
import { useLive } from '../live/context.js'
import { comboOf, isMac, keysBlocked } from './combo.js'

const BROWSER_KEY = 'even-keel.browser'
let fallbackId: string | null = null

/**
 * The id this browser keeps its hotkeys under (BTN-880), made once and kept in `localStorage`; each page address has
 * its own storage, so each is a browser of its own. Without storage the id lives as long as the tab.
 */
export function browserId(): string {
  try {
    const kept = localStorage.getItem(BROWSER_KEY)
    if (kept !== null && BROWSER_ID.test(kept)) return kept
    const made = newId()
    localStorage.setItem(BROWSER_KEY, made)
    return made
  } catch {
    fallbackId ??= newId()
    return fallbackId
  }
}

// `crypto.randomUUID` needs a secure context; a page opened by a LAN address over http has none.
function newId(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export interface HotkeyLayout {
  browser: string
  /** What this browser changed, sent whole on each change. */
  own: HotkeyBindings
  current: Record<HotkeyAction, string>
  mac: boolean
}

export function useHotkeyLayout(): HotkeyLayout {
  const { state } = useLive()
  const browser = browserId()
  const own = state?.hotkeys?.[browser] ?? {}
  return { browser, own, current: resolvedHotkeys(own), mac: isMac(navigator as Navigator & { userAgentData?: { platform?: string } }) }
}

/**
 * A dialog's own action (`chatTask`): the handler goes on the dialog's `onKeyDown` and runs `run` on the action's
 * combination pressed anywhere inside it, typing in its fields included; only an IME composing holds it.
 */
export function useDialogHotkey(action: HotkeyAction, run: () => void): (event: ReactKeyboardEvent) => void {
  const { current, mac } = useHotkeyLayout()
  return (event) => {
    if (event.repeat || event.nativeEvent.isComposing || comboOf(event, mac) !== current[action]) return
    event.preventDefault()
    run()
  }
}

/** Runs `run` on the action's combination while the calling component is on the page, unless a field or a dialog holds the keys. */
export function useHotkey(action: HotkeyAction, run: () => void): void {
  const { current, mac } = useHotkeyLayout()
  const combo = current[action]
  const latest = useRef(run)
  latest.current = run
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || keysBlocked(event, document) || comboOf(event, mac) !== combo) return
      event.preventDefault()
      latest.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [combo, mac])
}
