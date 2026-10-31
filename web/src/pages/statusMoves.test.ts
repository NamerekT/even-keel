import { describe, expect, it } from 'vitest'
import { DEFAULT_RULES } from '../../../src/chain/rules.js'
import type { TaskStatus } from '../../../src/tracker/model.js'
import { t } from '../i18n/index.js'
import { LEAVE, moveOptions, movesFrom, movesText, profileMoveLabel, profileMovesText } from './statusMoves.js'

const STATUSES: TaskStatus[] = [
  { name: 'Backlog', category: 'UnStarted' },
  { name: 'Todo', category: 'ToDo' },
  { name: 'In Progress', category: 'Active' },
  { name: 'In Review', category: 'Active' },
  { name: 'Done', category: 'Won' },
  { name: 'Canceled', category: 'Lost' },
]
const rules = { ...DEFAULT_RULES, terminal: ['Done', 'Canceled'] }
const values = (options: { value: string }[]) => options.map((each) => each.value)

describe('status moves of the page', () => {
  it('reads a source\'s "leave" as its own null and an unset key as none', () => {
    expect(movesText({ start: null, review: 'In Review' })).toEqual({ start: LEAVE, review: 'In Review', done: '' })
    expect(movesText(undefined)).toEqual({ start: '', review: '', done: '' })
    expect(movesFrom({ start: LEAVE, review: 'In Review', done: '' })).toEqual({ start: null, review: 'In Review' })
    expect(movesFrom({ start: '', review: '', done: 'Done' })).toEqual({ done: 'Done' })
    expect(profileMovesText({ start: null })).toEqual({ start: '', review: '', done: '' })
  })

  it("offers a profile's start and review the statuses in the chain after \"leave\", its completion the done ones after \"automatic\"", () => {
    const start = moveOptions('start', rules, STATUSES, '')
    expect(values(start)).toEqual(['', 'Todo', 'In Progress', 'In Review'])
    expect(start[0]!.label).toBe(t.profiles.moves.leave)
    const done = moveOptions('done', rules, STATUSES, '')
    expect(values(done)).toEqual(['', 'Done'])
    expect(done[0]!.label).toBe(t.profiles.moves.auto)
  })

  it('offers a source "as in the profile" first and "leave" for start and review only', () => {
    const profile = { start: 'In Progress' }
    const start = moveOptions('start', rules, STATUSES, '', profile)
    expect(values(start)).toEqual(['', LEAVE, 'Todo', 'In Progress', 'In Review'])
    expect(start[0]!.label).toBe(t.profiles.moves.asProfile('In Progress'))
    const done = moveOptions('done', rules, STATUSES, '', profile)
    expect(values(done)).toEqual(['', 'Done'])
    expect(done[0]!.label).toBe(t.profiles.moves.asProfile(t.profiles.moves.auto))
  })

  it('keeps a chosen status the list does not hold, so the field never shows a blank', () => {
    expect(values(moveOptions('review', rules, [], 'In Review'))).toEqual(['', 'In Review'])
    expect(values(moveOptions('done', rules, STATUSES, 'Closed'))).toEqual(['', 'Done', 'Closed'])
  })

  it("names a profile's value as the source's choice shows it", () => {
    expect(profileMoveLabel('review', { review: 'In Review' })).toBe('In Review')
    expect(profileMoveLabel('review', {})).toBe(t.profiles.moves.leave)
    expect(profileMoveLabel('done', undefined)).toBe(t.profiles.moves.auto)
  })
})
