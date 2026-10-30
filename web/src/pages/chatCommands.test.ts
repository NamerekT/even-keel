import { describe, expect, it } from 'vitest'
import { ghostOf, menuQuery, snappedSelection, tokenCut, withCommand } from './chatCommands.js'

describe('menuQuery', () => {
  it('opens on a slash at the start of the field, spaces before it allowed', () => {
    expect(menuQuery('/')).toBe('')
    expect(menuQuery('  /han')).toBe('han')
  })

  it('stays shut once a space follows the name, and for a slash anywhere else', () => {
    expect(menuQuery('/handoff ')).toBeNull()
    expect(menuQuery('text /han')).toBeNull()
    expect(menuQuery('')).toBeNull()
  })
})

describe('withCommand', () => {
  it('puts the picked command in place of what was typed, keeping the spaces before it', () => {
    expect(withCommand('/ha', 'handoff')).toBe('/handoff ')
    expect(withCommand('  /', 'handoff')).toBe('  /handoff ')
  })
})

describe('ghostOf', () => {
  it('asks to filter after a lone slash', () => {
    expect(ghostOf('/', 'en')).toEqual({ kind: 'filter', gap: false })
    expect(ghostOf(' /', 'en')).toEqual({ kind: 'filter', gap: false })
  })

  it('shows what may follow a command until something is written after it', () => {
    expect(ghostOf('/handoff', 'ru')).toEqual({ kind: 'args', text: '[что учесть]', gap: true })
    expect(ghostOf('/handoff ', 'en')).toEqual({ kind: 'args', text: '[what to keep in mind]', gap: false })
    expect(ghostOf('/handoff now', 'en')).toBeNull()
    expect(ghostOf('/huidoff', 'en')).toBeNull()
    expect(ghostOf('plain', 'en')).toBeNull()
  })
})

describe('snappedSelection', () => {
  it('selects the whole command when the caret lands inside it', () => {
    expect(snappedSelection('/handoff later', 3, 3)).toEqual([0, 8])
    expect(snappedSelection('  /handoff', 3, 3)).toEqual([2, 10])
  })

  it('leaves a caret at the edges, a selection and plain text alone', () => {
    expect(snappedSelection('/handoff later', 8, 8)).toBeNull()
    expect(snappedSelection('/handoff later', 0, 0)).toBeNull()
    expect(snappedSelection('/handoff later', 2, 5)).toBeNull()
    expect(snappedSelection('/huidoff', 3, 3)).toBeNull()
  })
})

describe('tokenCut', () => {
  it('removes the whole command on Backspace right after it', () => {
    expect(tokenCut('/handoff later', 8, 'Backspace')).toEqual({ text: ' later', caret: 0 })
    expect(tokenCut('  /handoff', 10, 'Backspace')).toEqual({ text: '  ', caret: 2 })
  })

  it('removes it on Delete right before it', () => {
    expect(tokenCut('/handoff later', 0, 'Delete')).toEqual({ text: ' later', caret: 0 })
  })

  it('leaves other keys and places alone', () => {
    expect(tokenCut('/handoff later', 10, 'Backspace')).toBeNull()
    expect(tokenCut('/handoff later', 8, 'Delete')).toBeNull()
    expect(tokenCut('/huidoff', 8, 'Backspace')).toBeNull()
  })
})
