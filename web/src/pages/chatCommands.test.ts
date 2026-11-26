import { describe, expect, it } from 'vitest'
import type { MenuEntry } from '../../../src/sessions/commands.js'
import { ghostOf, matchingItems, menuItems, menuQuery, snappedSelection, tokenCut, withCommand } from './chatCommands.js'

const ENTRIES: MenuEntry[] = [
  { name: 'handoff', kind: 'skill', from: 'user', description: 'a skill of the same name', args: '' },
  { name: 'coding', kind: 'skill', from: 'user', description: 'Working rules', args: '' },
  { name: 'tasks:split', kind: 'skill', from: 'package', description: 'Split a task', args: '[task]' },
]

describe('menuItems (BTN-1695)', () => {
  it("puts Even Keel's commands first and drops a session entry of the same name", () => {
    expect(menuItems('en', true, ENTRIES).map((item) => [item.name, item.group])).toEqual([
      ['handoff', 'even-keel'],
      ['coding', 'user'],
      ['tasks:split', 'package'],
    ])
    expect(menuItems('ru', true, [])[0]!.description).toBe('Передать задачу новой сессии с запиской')
  })

  it("leaves Even Keel's commands out of a project chat", () => {
    expect(menuItems('en', false, ENTRIES).map((item) => item.name)).toEqual(['handoff', 'coding', 'tasks:split'])
    expect(menuItems('en', false, ENTRIES)[0]!.group).toBe('user')
  })

  it('filters by any part of the name, a plugin prefix included', () => {
    const items = menuItems('en', true, ENTRIES)
    expect(matchingItems('SPL', items, '/').map((item) => item.name)).toEqual(['tasks:split'])
    expect(matchingItems('tasks:', items, '/').map((item) => item.name)).toEqual(['tasks:split'])
  })

  it("draws a session's skill as a command, its hint muted, and keeps it one piece", () => {
    const items = menuItems('en', true, ENTRIES)
    expect(ghostOf('/tasks:split', 'en', items)).toEqual({ kind: 'args', text: '[task]', gap: true })
    expect(ghostOf('/coding', 'en', items)).toBeNull()
    expect(snappedSelection('/coding now', 3, 3, items)).toEqual([0, 7])
    expect(tokenCut('/coding now', 7, 'Backspace', items)).toEqual({ text: ' now', caret: 0 })
    expect(tokenCut('/coding now', 7, 'Backspace')).toBeNull()
  })
})

describe('a Codex session (BTN-1737)', () => {
  const items = menuItems('en', true, ENTRIES, '$')

  it("marks the session's entries `$`, Even Keel's own `/`", () => {
    expect(items.map((item) => `${item.sigil}${item.name}`)).toEqual(['/handoff', '$coding', '$tasks:split'])
  })

  it('offers every item after a slash, only the `$` ones after a dollar', () => {
    expect(matchingItems('', items, '/').map((item) => item.name)).toEqual(['handoff', 'coding', 'tasks:split'])
    expect(matchingItems('', items, '$').map((item) => item.name)).toEqual(['coding', 'tasks:split'])
    expect(matchingItems('', menuItems('en', true, ENTRIES), '$')).toEqual([])
  })

  it('puts a picked skill in as `$name`, in place of a slash or a dollar', () => {
    expect(withCommand('/cod', 'coding', '$')).toBe('$coding ')
    expect(withCommand('  $', 'tasks:split', '$')).toBe('  $tasks:split ')
  })

  it('draws `$name` as a command, and a `/name` of a `$` item as plain text', () => {
    expect(ghostOf('$tasks:split', 'en', items)).toEqual({ kind: 'args', text: '[task]', gap: true })
    expect(ghostOf('$', 'en', items)).toEqual({ kind: 'filter', gap: false })
    expect(ghostOf('$', 'en', menuItems('en', true, ENTRIES))).toBeNull()
    expect(ghostOf('/tasks:split', 'en', items)).toBeNull()
    expect(snappedSelection('$coding now', 3, 3, items)).toEqual([0, 7])
    expect(tokenCut('$coding now', 7, 'Backspace', items)).toEqual({ text: ' now', caret: 0 })
    expect(tokenCut('/coding now', 7, 'Backspace', items)).toBeNull()
    expect(snappedSelection('$handoff now', 3, 3, items)).toBeNull()
  })
})

describe('menuQuery', () => {
  it('opens on a slash or a dollar at the start of the field, spaces before it allowed', () => {
    expect(menuQuery('/')).toEqual({ sigil: '/', typed: '' })
    expect(menuQuery('  /han')).toEqual({ sigil: '/', typed: 'han' })
    expect(menuQuery('$co')).toEqual({ sigil: '$', typed: 'co' })
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
