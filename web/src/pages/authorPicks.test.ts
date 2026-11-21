import { describe, expect, it } from 'vitest'
import type { ImportPlanAuthor } from '../../../src/tracker/import-plan.js'
import { authorChoices, authorKinds, pickAuthor } from './authorPicks.js'

const row = (over: Partial<ImportPlanAuthor>): ImportPlanAuthor => ({ kind: 'person', name: 'John Doe', tasks: 0, comments: 1, changes: 1, as: 'person', ...over })

describe('authorChoices', () => {
  it('sends every author of the plan with what it becomes', () => {
    const authors = [row({ kind: 'agent', name: null, as: 'agent' }), row({ name: 'Jane Roe', as: 'user' })]
    expect(authorChoices(authors)).toEqual([
      { kind: 'agent', name: null, as: 'agent' },
      { kind: 'person', name: 'Jane Roe', as: 'user' },
    ])
  })
})

describe('pickAuthor', () => {
  it('changes only the author of the same kind and name', () => {
    const authors = [row({ name: 'John Doe' }), row({ name: 'Jane Roe' }), row({ kind: 'user', name: 'John Doe', as: 'user' })]
    const picked = pickAuthor(authors, { kind: 'person', name: 'John Doe' }, 'agent')
    expect(picked.map((each) => each.as)).toEqual(['agent', 'person', 'user'])
    expect(authors[0]!.as).toBe('person')
  })

  it('tells an author without a name from one with an empty name', () => {
    const authors = [row({ kind: 'agent', name: null, as: 'agent' }), row({ kind: 'agent', name: '', as: 'agent' })]
    expect(pickAuthor(authors, { kind: 'agent', name: '' }, 'user').map((each) => each.as)).toEqual(['agent', 'user'])
  })
})

describe('authorKinds', () => {
  it('offers the agent, the user and the person under their name', () => {
    expect(authorKinds(row({}))).toEqual(['agent', 'user', 'person'])
  })

  it('offers no person for an author the tracker gives no name: it would be the user', () => {
    expect(authorKinds(row({ name: null }))).toEqual(['agent', 'user'])
  })
})
