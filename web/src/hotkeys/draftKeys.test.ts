import { describe, expect, it } from 'vitest'
import { DEFAULT_HOTKEYS } from '../../../src/hotkeys.js'
import { DRAFT_COMBOS, refusalOf, type KeyPress } from './combo.js'
import { storedDraft, writeDraft } from '../pages/settingsStore.js'
import { draftKeyOf, draftTargetOf, pressDraftKey, type DraftKeys } from './draftKeys.js'

const press = (code: string, mods: Partial<KeyPress> = {}, target: object | null = { tagName: 'BODY' }, isComposing = false) => ({
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
  isComposing,
  target: target as EventTarget | null,
})
const field = { tagName: 'INPUT', type: 'text' }

describe('draftKeyOf', () => {
  it('reads Ctrl+S, Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y elsewhere, the same with Cmd on a Mac', () => {
    expect(draftKeyOf(press('KeyS', { ctrlKey: true }), false)).toBe('save')
    expect(draftKeyOf(press('KeyZ', { ctrlKey: true }), false)).toBe('undo')
    expect(draftKeyOf(press('KeyZ', { ctrlKey: true, shiftKey: true }), false)).toBe('redo')
    expect(draftKeyOf(press('KeyY', { ctrlKey: true }), false)).toBe('redo')
    expect(draftKeyOf(press('KeyS', { metaKey: true }), true)).toBe('save')
    expect(draftKeyOf(press('KeyZ', { metaKey: true, shiftKey: true }), true)).toBe('redo')
    expect(draftKeyOf(press('KeyY', { metaKey: true }), true)).toBeNull()
    expect(draftKeyOf(press('KeyS', { ctrlKey: true }), true)).toBeNull()
    expect(draftKeyOf(press('KeyS', { ctrlKey: true, altKey: true }), false)).toBeNull()
  })

  it('saves from a text field too, but leaves Ctrl+Z there to the browser’s own undo', () => {
    expect(draftKeyOf(press('KeyS', { ctrlKey: true }, field), false)).toBe('save')
    for (const target of [field, { tagName: 'TEXTAREA' }, { tagName: 'DIV', isContentEditable: true }, { tagName: 'INPUT', type: 'number' }]) {
      expect(draftKeyOf(press('KeyZ', { ctrlKey: true }, target), false)).toBeNull()
      expect(draftKeyOf(press('KeyY', { ctrlKey: true }, target), false)).toBeNull()
    }
  })

  it('steps the draft from a switch, a check box, a select or a button', () => {
    for (const target of [{ tagName: 'INPUT', type: 'checkbox' }, { tagName: 'INPUT', type: 'radio' }, { tagName: 'SELECT' }, { tagName: 'BUTTON' }]) {
      expect(draftKeyOf(press('KeyZ', { ctrlKey: true }, target), false)).toBe('undo')
    }
  })

  it('takes nothing while an IME composes', () => {
    expect(draftKeyOf(press('KeyS', { ctrlKey: true }, field, true), false)).toBeNull()
    expect(draftKeyOf(press('KeyZ', { ctrlKey: true }, { tagName: 'BODY' }, true), false)).toBeNull()
  })
})

describe('draftTargetOf', () => {
  const dialog = { contains: (other: unknown) => other === dialog, closest: () => dialog }
  const panel = { contains: (other: unknown) => other === panel, closest: () => null }
  const modal = { contains: () => false, closest: () => modal }
  const panelForm = { element: panel }
  const dialogForm = { element: dialog }

  it('gives a key to the form on the page while no dialog is open', () => {
    expect(draftTargetOf([panelForm], null)).toBe(panelForm)
    expect(draftTargetOf([{ element: null }, panelForm], null)).toBe(panelForm)
  })

  it('gives it to the tracker window open over the panel, whichever registered first', () => {
    expect(draftTargetOf([panelForm, dialogForm], dialog)).toBe(dialogForm)
    expect(draftTargetOf([dialogForm, panelForm], dialog)).toBe(dialogForm)
  })

  it('gives it to nobody under another dialog, and keeps a closed window’s form out', () => {
    expect(draftTargetOf([panelForm, dialogForm], modal)).toBeUndefined()
    expect(draftTargetOf([dialogForm], null)).toBeUndefined()
  })
})

describe('pressDraftKey', () => {
  interface Box {
    contains(other: unknown): boolean
    closest(selector: string): unknown
  }
  const page: Box = { contains: (other) => other === page, closest: () => null }
  const window: Box = { contains: (other) => other === window, closest: () => window }
  const form = (canSave: boolean, element: Box = page, parts: DraftKeys['parts'] = []) => {
    const saves: string[] = []
    return { saves, entry: { element, keys: { current: { canSave, save: () => saves.push('saved'), parts } } } }
  }
  const key = (code: string, mods: Partial<KeyPress> = {}, target: object = { tagName: 'BODY' }, repeat = false) => {
    const event = { ...press(code, mods, target), repeat, prevented: false, preventDefault: () => void (event.prevented = true) }
    return event
  }

  it('saves on Ctrl+S from a text field and takes the key', () => {
    const one = form(true)
    const event = key('KeyS', { ctrlKey: true }, field)
    pressDraftKey(event, [one.entry], null, false)
    expect(one.saves).toEqual(['saved'])
    expect(event.prevented).toBe(true)
  })

  it('does not save with nothing to save or on a repeat, but still keeps the key from the browser', () => {
    const idle = form(false)
    const event = key('KeyS', { ctrlKey: true })
    pressDraftKey(event, [idle.entry], null, false)
    expect(idle.saves).toEqual([])
    expect(event.prevented).toBe(true)
    const ready = form(true)
    pressDraftKey(key('KeyS', { ctrlKey: true }, {}, true), [ready.entry], null, false)
    expect(ready.saves).toEqual([])
  })

  it('saves the tracker window open over the panel, not the panel', () => {
    const panel = form(true)
    const dialog = form(true, window)
    pressDraftKey(key('KeyS', { ctrlKey: true }), [panel.entry, dialog.entry], window, false)
    expect(dialog.saves).toEqual(['saved'])
    expect(panel.saves).toEqual([])
  })

  it('steps the open section’s draft back outside a field and takes the key only when it did', () => {
    const base = { a: '' }
    writeDraft('test:press', { base, edit: base }, { base, edit: { a: 'x' } })
    const one = form(true, page, [{ scope: 'test:press' }])
    const inField = key('KeyZ', { ctrlKey: true }, field)
    pressDraftKey(inField, [one.entry], null, false)
    expect(inField.prevented).toBe(false)
    expect(storedDraft('test:press')?.edit).toEqual({ a: 'x' })
    const outside = key('KeyZ', { ctrlKey: true })
    pressDraftKey(outside, [one.entry], null, false)
    expect(outside.prevented).toBe(true)
    expect(storedDraft('test:press')?.edit).toEqual({ a: '' })
    const again = key('KeyZ', { ctrlKey: true })
    pressDraftKey(again, [one.entry], null, false)
    expect(again.prevented).toBe(false)
    pressDraftKey(key('KeyY', { ctrlKey: true }), [one.entry], null, false)
    expect(storedDraft('test:press')?.edit).toEqual({ a: 'x' })
  })
})

it('keeps the forms’ keys from being taken by an action and names what holds them', () => {
  for (const [key, combos] of Object.entries(DRAFT_COMBOS)) for (const combo of combos) expect(refusalOf(combo, 'chainRun', { ...DEFAULT_HOTKEYS })).toEqual({ kind: 'draft', key })
})
