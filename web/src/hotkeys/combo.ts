import { parseCombo, type HotkeyAction, type Modifier } from '../../../src/hotkeys.js'

/** The fields of a `KeyboardEvent` a combination is read from. */
export interface KeyPress {
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

const MODIFIER_CODE = /^(?:Shift|Control|Alt|Meta|OS)(?:Left|Right)?$|^(?:AltGraph|CapsLock|Fn|FnLock|NumLock)$/

/**
 * The combination a key press makes, by the physical key (`code`), so a Cyrillic layout gives the same `Mod+T`;
 * `null` — a modifier pressed alone or a key a combination does not take.
 */
export function comboOf(press: KeyPress, mac: boolean): string | null {
  if (MODIFIER_CODE.test(press.code)) return null
  const key = keyOfCode(press.code)
  const modifiers: Modifier[] = []
  if (mac ? press.metaKey : press.ctrlKey) modifiers.push('Mod')
  if (mac && press.ctrlKey) modifiers.push('Ctrl')
  if (!mac && press.metaKey) modifiers.push('Meta')
  if (press.altKey) modifiers.push('Alt')
  if (press.shiftKey) modifiers.push('Shift')
  const text = [...modifiers, key].join('+')
  return parseCombo(text) === null ? null : text
}

function keyOfCode(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (code === 'NumpadEnter') return 'Enter'
  return code
}

const MAC_SYMBOLS: [Modifier, string][] = [
  ['Ctrl', '⌃'],
  ['Alt', '⌥'],
  ['Shift', '⇧'],
  ['Mod', '⌘'],
]
const OTHER_NAMES: Record<Modifier, string> = { Mod: 'Ctrl', Ctrl: 'Ctrl', Meta: 'Win', Alt: 'Alt', Shift: 'Shift' }
const KEY_LABELS: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
}

/** A combination as the person's system writes it: `⌘ Enter` on a Mac, `Ctrl+Enter` elsewhere; never the word `Mod`. */
export function formatCombo(text: string, mac: boolean): string {
  const combo = parseCombo(text)
  if (combo === null) return text
  const key = KEY_LABELS[combo.key] ?? combo.key
  if (!mac) return [...combo.modifiers.map((modifier) => OTHER_NAMES[modifier]), key].join('+')
  const symbols = MAC_SYMBOLS.filter(([modifier]) => combo.modifiers.includes(modifier)).map(([, symbol]) => symbol)
  return symbols.length === 0 ? key : `${symbols.join('')} ${key}`
}

/** Why a recorded combination is not taken. */
export type Refusal = { kind: 'taken'; action: HotkeyAction } | { kind: 'bare' } | { kind: 'reserved' }

/** Browsers keep these for tabs and windows and never hand them to the page. */
const RESERVED_KEYS = ['W', 'T', 'N', 'L', 'Tab', 'Q']

export function refusalOf(text: string, action: HotkeyAction, current: Readonly<Record<HotkeyAction, string>>): Refusal | null {
  const combo = parseCombo(text)
  if (combo === null) return { kind: 'bare' }
  const has = (modifier: Modifier) => combo.modifiers.includes(modifier)
  if ((has('Mod') && RESERVED_KEYS.includes(combo.key)) || (has('Ctrl') && combo.key === 'Tab')) return { kind: 'reserved' }
  const held = has('Mod') || has('Ctrl') || has('Meta') || has('Alt')
  if (!held && !/^F\d+$/.test(combo.key)) return { kind: 'bare' }
  const other = Object.entries(current).find(([each, held]) => each !== action && held === text)
  return other === undefined ? null : { kind: 'taken', action: other[0] as HotkeyAction }
}

/** A Mac by the browser's own word: `userAgentData.platform` where there is one, else `navigator.platform`. */
export function isMac(nav: { platform?: string; userAgentData?: { platform?: string } }): boolean {
  return /mac/i.test(nav.userAgentData?.platform ?? nav.platform ?? '')
}

interface KeyTarget {
  tagName?: string
  isContentEditable?: boolean
}

/** The page's hotkeys stay quiet while a field takes the typing, an IME composes, or any dialog is open. */
export function keysBlocked(event: { isComposing: boolean; target: EventTarget | null }, doc: { querySelector(selector: string): unknown }): boolean {
  if (event.isComposing) return true
  const target = event.target as KeyTarget | null
  if (target?.isContentEditable === true || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) return true
  return doc.querySelector('dialog[open]') !== null
}
