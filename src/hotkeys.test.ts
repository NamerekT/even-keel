import { describe, expect, it } from 'vitest'
import { comboText, hotkeyBindingsOf, parseCombo, resolvedHotkeys } from './hotkeys.js'

describe('parseCombo', () => {
  it('reads modifiers in their order and one key', () => {
    expect(parseCombo('Mod+Enter')).toEqual({ modifiers: ['Mod'], key: 'Enter' })
    expect(parseCombo('Mod+Alt+Shift+K')).toEqual({ modifiers: ['Mod', 'Alt', 'Shift'], key: 'K' })
    expect(parseCombo('F5')).toEqual({ modifiers: [], key: 'F5' })
  })

  it('refuses a modifier out of order or twice, an unknown key, no key', () => {
    expect(parseCombo('Shift+Mod+K')).toBeNull()
    expect(parseCombo('Mod+Mod+K')).toBeNull()
    expect(parseCombo('Mod+Unknown')).toBeNull()
    expect(parseCombo('Mod+')).toBeNull()
    expect(parseCombo('Mod')).toBeNull()
    expect(parseCombo('F13')).toBeNull()
  })

  it('writes back what it read', () => {
    expect(comboText(parseCombo('Mod+Shift+ArrowUp')!)).toBe('Mod+Shift+ArrowUp')
  })
})

describe('hotkeyBindingsOf', () => {
  it('takes known actions with valid combinations', () => {
    expect(hotkeyBindingsOf({ chainRun: 'Mod+Shift+Enter' })).toEqual({ chainRun: 'Mod+Shift+Enter' })
    expect(hotkeyBindingsOf({})).toEqual({})
  })

  it('refuses an unknown action, a broken combination or not an object', () => {
    expect(hotkeyBindingsOf({ other: 'Mod+K' })).toBeNull()
    expect(hotkeyBindingsOf({ chainRun: 'Enter+Mod' })).toBeNull()
    expect(hotkeyBindingsOf({ chainRun: 5 })).toBeNull()
    expect(hotkeyBindingsOf(['Mod+K'])).toBeNull()
    expect(hotkeyBindingsOf(null)).toBeNull()
  })
})

it('a browser without its own layout gets the defaults', () => {
  expect(resolvedHotkeys(undefined)).toEqual({ chainRun: 'Mod+Enter' })
  expect(resolvedHotkeys({ chainRun: 'F9' })).toEqual({ chainRun: 'F9' })
})
