import { describe, expect, it } from 'vitest'
import type { TaskComment } from '../../../src/tracker/card.js'
import type { TaskChange } from '../../../src/tracker/history.js'
import { changeRows, changeRun, journalAuthor, journalItems, journalModel, journalWindow, JOURNAL_SHOWN, repliesOf } from './journalView.js'

const note = (at: number, journal?: TaskComment['journal']): TaskComment => ({ author: 'John Doe', at, text: `note ${at}`, journal })

const texts = { you: 'You', agent: 'Agent', service: 'Even Keel', noAuthor: 'no author' }

describe('journalWindow', () => {
  it('puts the newest entry first whatever order the tracker gave (BTN-1451)', () => {
    const { shown, hidden } = journalWindow([note(1), note(3), note(2)], false)
    expect(shown.map((each) => each.at)).toEqual([3, 2, 1])
    expect(hidden).toBe(0)
  })

  it('shows only the newest entries of a long journal and counts the older rest', () => {
    const comments = Array.from({ length: JOURNAL_SHOWN + 5 }, (_, index) => note(index))
    const { shown, hidden } = journalWindow(comments, false)
    expect(shown).toHaveLength(JOURNAL_SHOWN)
    expect(shown[0]!.at).toBe(JOURNAL_SHOWN + 4)
    expect(shown.at(-1)!.at).toBe(5)
    expect(hidden).toBe(5)
  })

  it('shows every entry once asked to, the oldest last', () => {
    const comments = Array.from({ length: JOURNAL_SHOWN + 5 }, (_, index) => note(index))
    const { shown, hidden } = journalWindow(comments, true)
    expect(shown).toHaveLength(JOURNAL_SHOWN + 5)
    expect(shown.at(-1)!.at).toBe(0)
    expect(hidden).toBe(0)
  })
})

describe('journalAuthor', () => {
  it('names the person by "You", not by their tracker name', () => {
    expect(journalAuthor(note(1, { id: 'c1', by: 'person', model: null }), texts)).toBe('You')
  })

  it('names an agent alone: its model is a tag of its own', () => {
    expect(journalAuthor(note(1, { id: 'c1', by: 'agent', model: 'Claude | opus' }), texts)).toBe('Agent')
    expect(journalModel('Claude | opus')).toEqual({ provider: 'claude', model: 'opus', effort: null })
    expect(journalModel('OpenCode | openrouter/vendor/model-x')).toEqual({ provider: 'opencode', model: 'openrouter/vendor/model-x', effort: null })
    expect(journalModel(null)).toBeNull()
    expect(journalModel('opus')).toBeNull()
  })

  it('names Even Keel for its own entries', () => {
    expect(journalAuthor(note(1, { id: 'c1', by: 'service', model: null }), texts)).toBe('Even Keel')
  })

  it('keeps the tracker author of a comment outside a journal', () => {
    expect(journalAuthor(note(1), texts)).toBe('John Doe')
    expect(journalAuthor({ author: null, at: 1, text: '' }, texts)).toBe('no author')
  })
})

describe('journalItems (BTN-1112)', () => {
  const change = (at: number, field: TaskChange['field'], from: string | null, to: string | null, by: TaskChange['by'] = 'person'): TaskChange => ({ at, by, model: null, field, from, to })
  const history = [change(1_000, 'status', 'Todo', 'In Progress'), change(2_000, 'label', null, 'bug'), change(400_000, 'priority', 'none', 'high', 'agent')]

  it('mixes the comments and the grouped changes by time', () => {
    const items = journalItems([note(3_000), note(500_000)], history, 'all')
    expect(items.map((each) => [each.kind, each.at])).toEqual([['changes', 1_000], ['comment', 3_000], ['changes', 400_000], ['comment', 500_000]])
  })

  it('keeps one kind under a filter, and the window counts only what it keeps', () => {
    expect(journalItems([note(3_000)], history, 'comments').map((each) => each.kind)).toEqual(['comment'])
    expect(journalItems([note(3_000)], history, 'changes').map((each) => each.kind)).toEqual(['changes', 'changes'])
  })

  it('gathers the labels of one entry in one row, each other field a row of its own', () => {
    const [group] = journalItems([], [change(1, 'label', null, 'bug'), change(2, 'status', 'Todo', 'Done'), change(3, 'label', 'ui', null)], 'all')
    expect(group?.kind === 'changes' && changeRows(group.group).map((row) => [row.field, row.changes.length])).toEqual([['label', 2], ['status', 1]])
  })

  it('reads a run change back, and none for no run', () => {
    expect(changeRun('{"provider":"codex","model":"gpt-example","effort":"high"}')).toEqual({ provider: 'codex', model: 'gpt-example', effort: 'high' })
    expect(changeRun(null)).toBeNull()
    expect(changeRun('not json')).toBeNull()
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
