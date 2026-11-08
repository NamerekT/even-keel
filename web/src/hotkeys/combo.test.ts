import { describe, expect, it } from 'vitest'
import { DEFAULT_HOTKEYS, type HotkeyAction } from '../../../src/hotkeys.js'
import { chainControls } from '../state.js'
import { chainRunControl } from './actions.js'
import { comboOf, formatCombo, isMac, keysBlocked, refusalOf, type KeyPress } from './combo.js'

const press = (code: string, mods: Partial<KeyPress> = {}): KeyPress => ({ code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods })

describe('comboOf', () => {
  it('reads Cmd as Mod on a Mac and Ctrl as Mod elsewhere', () => {
    expect(comboOf(press('Enter', { metaKey: true }), true)).toBe('Mod+Enter')
    expect(comboOf(press('Enter', { ctrlKey: true }), false)).toBe('Mod+Enter')
    expect(comboOf(press('Enter', { ctrlKey: true }), true)).toBe('Ctrl+Enter')
    expect(comboOf(press('Enter', { metaKey: true }), false)).toBe('Meta+Enter')
  })

  it('takes the physical key, so another layout gives the same letter', () => {
    expect(comboOf(press('KeyT', { ctrlKey: true, shiftKey: true }), false)).toBe('Mod+Shift+T')
    expect(comboOf(press('Digit5', { altKey: true }), false)).toBe('Alt+5')
    expect(comboOf(press('NumpadEnter', { ctrlKey: true }), false)).toBe('Mod+Enter')
  })

  it('gives nothing for a modifier alone or a key it does not know', () => {
    expect(comboOf(press('ControlLeft', { ctrlKey: true }), false)).toBeNull()
    expect(comboOf(press('MetaRight', { metaKey: true }), true)).toBeNull()
    expect(comboOf(press('MediaPlayPause'), false)).toBeNull()
  })
})

describe('formatCombo', () => {
  it('writes symbols on a Mac and names elsewhere, never Mod', () => {
    expect(formatCombo('Mod+Enter', true)).toBe('⌘ Enter')
    expect(formatCombo('Mod+Enter', false)).toBe('Ctrl+Enter')
    expect(formatCombo('Mod+Alt+Shift+K', true)).toBe('⌥⇧⌘ K')
    expect(formatCombo('Mod+Alt+Shift+K', false)).toBe('Ctrl+Alt+Shift+K')
    expect(formatCombo('Meta+ArrowUp', false)).toBe('Win+↑')
    expect(formatCombo('F5', true)).toBe('F5')
  })
})

describe('refusalOf', () => {
  const current = { ...DEFAULT_HOTKEYS }

  it('takes a combination with a modifier, or a bare F key', () => {
    expect(refusalOf('Mod+Shift+Enter', 'chainRun', current)).toBeNull()
    expect(refusalOf('F9', 'chainRun', current)).toBeNull()
    expect(refusalOf('Mod+Enter', 'chainRun', current)).toBeNull()
  })

  it('refuses a bare key, Shift alone included', () => {
    expect(refusalOf('K', 'chainRun', current)).toEqual({ kind: 'bare' })
    expect(refusalOf('Shift+Enter', 'chainRun', current)).toEqual({ kind: 'bare' })
  })

  it('refuses what the browser keeps for tabs and windows', () => {
    for (const key of ['W', 'T', 'N', 'L', 'Tab', 'Q']) expect(refusalOf(`Mod+${key}`, 'chainRun', current)).toEqual({ kind: 'reserved' })
    expect(refusalOf('Mod+Shift+T', 'chainRun', current)).toEqual({ kind: 'reserved' })
    expect(refusalOf('Ctrl+Tab', 'chainRun', current)).toEqual({ kind: 'reserved' })
  })

  it('keeps Enter for the chat field from an action that runs while typing there', () => {
    for (const combo of ['Mod+Enter', 'Alt+Enter', 'Mod+Shift+Enter']) expect(refusalOf(combo, 'chatTask', current)).toEqual({ kind: 'field' })
    expect(refusalOf('Mod+Shift+Enter', 'chainRun', current)).toBeNull()
  })

  it('refuses a combination another action holds and names it', () => {
    const two = { ...current, other: 'Mod+K' } as unknown as Record<HotkeyAction, string>
    expect(refusalOf('Mod+K', 'chainRun', two)).toEqual({ kind: 'taken', action: 'other' })
  })
})

it('tells a Mac by userAgentData first, then by platform', () => {
  expect(isMac({ userAgentData: { platform: 'macOS' }, platform: 'Win32' })).toBe(true)
  expect(isMac({ platform: 'MacIntel' })).toBe(true)
  expect(isMac({ userAgentData: { platform: 'Windows' }, platform: 'MacIntel' })).toBe(false)
  expect(isMac({ platform: 'Linux x86_64' })).toBe(false)
  expect(isMac({})).toBe(false)
})

describe('keysBlocked', () => {
  const page = (dialog: boolean) => ({ querySelector: (selector: string) => (dialog && selector === 'dialog[open]' ? {} : null) })
  const key = (target: object | null, isComposing = false) => ({ isComposing, target: target as EventTarget | null })

  it('lets a key through on the page itself', () => {
    expect(keysBlocked(key({ tagName: 'BODY' }), page(false))).toBe(false)
    expect(keysBlocked(key({ tagName: 'BUTTON' }), page(false))).toBe(false)
    expect(keysBlocked(key(null), page(false))).toBe(false)
  })

  it('holds keys in a field, in editable text and while an IME composes', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) expect(keysBlocked(key({ tagName }), page(false))).toBe(true)
    expect(keysBlocked(key({ tagName: 'DIV', isContentEditable: true }), page(false))).toBe(true)
    expect(keysBlocked(key({ tagName: 'BODY' }, true), page(false))).toBe(true)
  })

  it('holds keys while any dialog is open', () => {
    expect(keysBlocked(key({ tagName: 'BODY' }), page(true))).toBe(true)
  })
})

describe('chainRunControl', () => {
  const order = { order: ['ABC-1'], error: null } as never

  it('starts an idle chain and resumes a paused one', () => {
    expect(chainRunControl(chainControls({ kind: 'idle' }, order))).toBe('start')
    expect(chainRunControl(chainControls({ kind: 'paused', error: null }, order))).toBe('resume')
  })

  it('does nothing to a running, queued or empty chain', () => {
    expect(chainRunControl(chainControls({ kind: 'running', limitUntil: null }, order))).toBeNull()
    expect(chainRunControl(chainControls({ kind: 'queued', position: 1 }, order))).toBeNull()
    expect(chainRunControl(chainControls({ kind: 'idle' }, { order: [], error: null } as never))).toBeNull()
    expect(chainRunControl(chainControls({ kind: 'idle' }, undefined))).toBeNull()
  })
})
