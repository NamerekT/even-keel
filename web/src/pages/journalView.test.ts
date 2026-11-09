import { describe, expect, it } from 'vitest'
import type { TaskComment } from '../../../src/tracker/card.js'
import { journalAuthor, journalWindow, JOURNAL_SHOWN, repliesOf } from './journalView.js'

const note = (at: number, journal?: TaskComment['journal']): TaskComment => ({ author: 'John Doe', at, text: `note ${at}`, journal })

const texts = { you: 'You', agent: 'Agent', service: 'Even Keel', noAuthor: 'no author' }

describe('journalWindow', () => {
  it('puts the oldest entry first whatever order the tracker gave', () => {
    const { shown, hidden } = journalWindow([note(3), note(1), note(2)], false)
    expect(shown.map((each) => each.at)).toEqual([1, 2, 3])
    expect(hidden).toBe(0)
  })

  it('shows only the last entries of a long journal and counts the rest', () => {
    const comments = Array.from({ length: JOURNAL_SHOWN + 5 }, (_, index) => note(index))
    const { shown, hidden } = journalWindow(comments, false)
    expect(shown).toHaveLength(JOURNAL_SHOWN)
    expect(shown[0]!.at).toBe(5)
    expect(shown.at(-1)!.at).toBe(JOURNAL_SHOWN + 4)
    expect(hidden).toBe(5)
  })

  it('shows every entry once asked to', () => {
    const comments = Array.from({ length: JOURNAL_SHOWN + 5 }, (_, index) => note(index))
    const { shown, hidden } = journalWindow(comments, true)
    expect(shown).toHaveLength(JOURNAL_SHOWN + 5)
    expect(hidden).toBe(0)
  })
})

describe('journalAuthor', () => {
  it('names the person by "You", not by their tracker name', () => {
    expect(journalAuthor(note(1, { id: 'c1', by: 'person', model: null }), texts)).toBe('You')
  })

  it('gives an agent its model when the journal knows it', () => {
    expect(journalAuthor(note(1, { id: 'c1', by: 'agent', model: 'Claude | opus' }), texts)).toBe('Agent · Claude | opus')
    expect(journalAuthor(note(1, { id: 'c1', by: 'agent', model: null }), texts)).toBe('Agent')
  })

  it('names Even Keel for its own entries', () => {
    expect(journalAuthor(note(1, { id: 'c1', by: 'service', model: null }), texts)).toBe('Even Keel')
  })

  it('keeps the tracker author of a comment outside a journal', () => {
    expect(journalAuthor(note(1), texts)).toBe('John Doe')
    expect(journalAuthor({ author: null, at: 1, text: '' }, texts)).toBe('no author')
  })
})

describe('repliesOf', () => {
  it('gives the thread oldest first whatever order the tracker gave', () => {
    expect(repliesOf({ ...note(1), replies: [note(4), note(2), note(3)] }).map((each) => each.at)).toEqual([2, 3, 4])
  })

  it('gives nothing for a comment without a thread', () => {
    expect(repliesOf(note(1))).toEqual([])
  })
})
