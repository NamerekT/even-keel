import { describe, expect, it } from 'vitest'
import { notice } from '../../../src/notice/notice.js'
import type { SubtaskRef } from '../../../src/tracker/card.js'
import type { StatusCategory } from '../../../src/tracker/model.js'
import {
  carriedSubtasks, chainOrdered, conflictOf, foreignMilestone, labelOffers, linkBody, linkRefusal, parentRefusal, removeRefusal, statusRoute,
} from './cardEdit.js'

const status = (category: StatusCategory, name: string = category) => ({ name, category })
const ref = (id: string, category: StatusCategory = 'ToDo', milestone: string | null = null): SubtaskRef => ({ id, title: id, status: status(category), milestone })

describe('statusRoute', () => {
  it('takes "Into the chain" and "To the backlog" where the chain has them, an edit otherwise', () => {
    expect(statusRoute(status('UnStarted'), status('ToDo'))).toBe('ready')
    expect(statusRoute(status('Active'), status('UnStarted'))).toBe('unready')
    expect(statusRoute(status('ToDo'), status('UnStarted'))).toBe('unready')
    expect(statusRoute(status('Active'), status('Won'))).toBe('edit')
    expect(statusRoute(status('Won'), status('UnStarted'))).toBe('edit')
    expect(statusRoute(status('ToDo'), status('Active'))).toBe('edit')
  })
})

describe('linkRefusal', () => {
  const card = { id: 'ABC-1', blockedBy: [ref('ABC-2')], blocks: [ref('ABC-3')], related: [ref('XYZ-1')] }

  it('refuses the task itself and a link it already has, of the same kind', () => {
    expect(linkRefusal(card, 'relates', 'ABC-1')).toEqual(notice('builtin.selfLink', { task: 'ABC-1' }))
    expect(linkRefusal(card, 'blockedBy', 'ABC-2')).toEqual(notice('builtin.linkExists', { task: 'ABC-1', other: 'ABC-2' }))
    expect(linkRefusal(card, 'blocks', 'ABC-3')?.code).toBe('builtin.linkExists')
    expect(linkRefusal(card, 'relates', 'XYZ-1')?.code).toBe('builtin.linkExists')
  })

  it('lets another kind of link to the same task through: the service judges loops and milestones', () => {
    expect(linkRefusal(card, 'relates', 'ABC-2')).toBeNull()
    expect(linkRefusal(card, 'blocks', 'ABC-2')).toBeNull()
  })

  it('sends "blocked by" as the other task blocking this one', () => {
    expect(linkBody('ABC-1', 'blockedBy', 'ABC-2')).toEqual({ task: 'ABC-2', other: 'ABC-1', kind: 'blocks' })
    expect(linkBody('ABC-1', 'relates', 'ABC-2')).toEqual({ task: 'ABC-1', other: 'ABC-2', kind: 'relates' })
  })
})

describe('parentRefusal', () => {
  it('refuses the task itself and its own subtask', () => {
    expect(parentRefusal('ABC-1', [ref('ABC-2')], 'ABC-1')?.code).toBe('builtin.selfParent')
    expect(parentRefusal('ABC-1', [ref('ABC-2')], 'ABC-2')).toEqual(notice('builtin.parentCycle', { task: 'ABC-1', parent: 'ABC-2' }))
    expect(parentRefusal('ABC-1', [ref('ABC-2')], 'ABC-5')).toBeNull()
  })
})

describe('subtasks', () => {
  it('go in the chain order, the rest after it by number', () => {
    const list = [ref('ABC-10'), ref('ABC-2', 'Won'), ref('ABC-7'), ref('ABC-9')]
    expect(chainOrdered(list, ['ABC-7', 'ABC-1', 'ABC-10']).map((each) => each.id)).toEqual(['ABC-7', 'ABC-10', 'ABC-2', 'ABC-9'])
  })

  it('a milestone change carries the open subtasks not already there', () => {
    const list = [ref('ABC-2', 'ToDo', 'v0.2'), ref('ABC-3', 'Won', 'v0.2'), ref('ABC-4', 'Active', 'V0.3'), ref('ABC-5', 'UnStarted')]
    expect(carriedSubtasks(list, 'v0.3').map((each) => each.id)).toEqual(['ABC-2', 'ABC-5'])
    expect(carriedSubtasks(list, null).map((each) => each.id)).toEqual(['ABC-2', 'ABC-4'])
  })
})

describe('labelOffers', () => {
  const known = [{ name: 'Manual', builtin: true }, { name: 'Bug', builtin: true }, { name: 'UI', builtin: false }]

  it('offers the labels the task lacks and a new one by the typed name', () => {
    expect(labelOffers(known, ['bug'], '').map((each) => each.name)).toEqual(['Manual', 'UI'])
    expect(labelOffers(known, [], ' Later ').at(-1)).toEqual({ name: 'Later', builtin: false, create: true })
  })

  it('creates nothing under a name a label already has, ignoring case', () => {
    expect(labelOffers(known, [], 'ui').some((each) => each.create)).toBe(false)
    expect(labelOffers(known, ['Later'], 'later').some((each) => each.create)).toBe(false)
  })
})

describe('foreignMilestone', () => {
  it('follows the project tasks rule', () => {
    expect(foreignMilestone({ requiredMilestones: [], excludedMilestones: [] }, 'v0.3')).toBe(false)
    expect(foreignMilestone({ requiredMilestones: ['v0.2'], excludedMilestones: [] }, 'v0.3')).toBe(true)
    expect(foreignMilestone({ requiredMilestones: [], excludedMilestones: ['Later'] }, 'later')).toBe(true)
  })
})

describe('conflictOf', () => {
  it('is only the same field changed otherwise', () => {
    const conflict = notice('builtin.conflict', { task: 'ABC-1', field: 'title', current: 'Theirs' })
    expect(conflictOf(conflict, 'Mine')).toEqual({ field: 'title', theirs: 'Theirs', mine: 'Mine' })
    expect(conflictOf(notice('builtin.selfLink', { task: 'ABC-1' }), 'Mine')).toBeNull()
    expect(conflictOf(null, 'Mine')).toBeNull()
  })
})

describe('removeRefusal', () => {
  it('refuses while the chain holds the task or a session of it lives', () => {
    expect(removeRefusal('ABC-1', true, true)).toEqual(notice('builtin.removeBusy', { task: 'ABC-1', why: 'current' }))
    expect(removeRefusal('ABC-1', false, true)?.params).toEqual({ task: 'ABC-1', why: 'live' })
    expect(removeRefusal('ABC-1', false, false)).toBeNull()
  })
})
