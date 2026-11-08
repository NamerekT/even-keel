/**
 * The page's hotkeys (BTN-880), shared by the server, which keeps a browser's layout, and the page, which reads keys.
 * A combination is neutral text: modifiers in the order of `MODIFIERS`, then one key, joined by `+` (`Mod+Enter`).
 * `Mod` is Cmd on a Mac and Ctrl elsewhere; `Ctrl` is a Mac's Control, `Meta` the Windows key elsewhere.
 */

export const HOTKEY_ACTIONS = ['chainRun'] as const
export type HotkeyAction = (typeof HOTKEY_ACTIONS)[number]

/** A browser's own combinations: only the actions it changed, the rest keep `DEFAULT_HOTKEYS`. */
export type HotkeyBindings = Partial<Record<HotkeyAction, string>>

export const DEFAULT_HOTKEYS: Readonly<Record<HotkeyAction, string>> = { chainRun: 'Mod+Enter' }

export const MODIFIERS = ['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift'] as const
export type Modifier = (typeof MODIFIERS)[number]

const KEY = /^(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|Enter|Space|Tab|Escape|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Arrow(?:Up|Down|Left|Right)|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Backquote)$/

/** The id a browser made for itself and keeps in its `localStorage`. */
export const BROWSER_ID = /^[A-Za-z0-9-]{8,64}$/

export interface Combo {
  modifiers: Modifier[]
  key: string
}

/** `null` — not a combination: an unknown key, a modifier out of order or twice, no key. */
export function parseCombo(text: string): Combo | null {
  const parts = text.split('+')
  const key = parts.pop()!
  if (!KEY.test(key)) return null
  let last = -1
  for (const part of parts) {
    const at = MODIFIERS.indexOf(part as Modifier)
    if (at <= last) return null
    last = at
  }
  return { modifiers: parts as Modifier[], key }
}

export function comboText(combo: Combo): string {
  return [...combo.modifiers, combo.key].join('+')
}

export function isHotkeyAction(value: string): value is HotkeyAction {
  return (HOTKEY_ACTIONS as readonly string[]).includes(value)
}

/** A layout as the page sent it; `null` — not one: an unknown action or a broken combination. */
export function hotkeyBindingsOf(raw: unknown): HotkeyBindings | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const bindings: HotkeyBindings = {}
  for (const [action, combo] of Object.entries(raw)) {
    if (!isHotkeyAction(action) || typeof combo !== 'string' || parseCombo(combo) === null) return null
    bindings[action] = combo
  }
  return bindings
}

/** Every action's combination: the browser's own over the defaults. */
export function resolvedHotkeys(own: HotkeyBindings | undefined): Record<HotkeyAction, string> {
  return { ...DEFAULT_HOTKEYS, ...own }
}
