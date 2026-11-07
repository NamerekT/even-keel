import { describe, expect, it } from 'vitest'
import { BACKLOG_PLACE, chainPlace, draftKey, emptyMilestones, looseGhost, takesGhost } from './addGhost.js'

const ALL = { requiredMilestones: [], excludedMilestones: [] }
const item = (open: boolean, locked = false) => ({ open, locked })

describe('where the add ghost stands', () => {
  it('ends a section with an open task, and an empty milestone group', () => {
    expect(takesGhost({ milestone: 'v0.3', blocks: [item(false), item(true)] }, ALL)).toBe(true)
    expect(takesGhost({ milestone: 'v0.4', blocks: [] }, ALL)).toBe(true)
    expect(takesGhost({ milestone: null, blocks: [item(true)] }, ALL)).toBe(true)
  })

  it('does not end a section of closed tasks only: the last task of a closed milestone', () => {
    expect(takesGhost({ milestone: 'v0.2', blocks: [item(false)] }, ALL)).toBe(false)
  })

  it('counts a locked blocker shown in the chain as open', () => {
    expect(takesGhost({ milestone: 'v0.3', blocks: [item(false, true)] }, ALL)).toBe(true)
  })

  it('leaves out a milestone, or tasks without one, that "Project tasks" does not take', () => {
    expect(takesGhost({ milestone: 'Later', blocks: [] }, { requiredMilestones: [], excludedMilestones: ['later'] })).toBe(false)
    const required = { requiredMilestones: ['v0.3'], excludedMilestones: [] }
    expect(takesGhost({ milestone: null, blocks: [item(true)] }, required)).toBe(false)
    expect(takesGhost({ milestone: 'V0.3', blocks: [item(true)] }, required)).toBe(true)
  })

  it('stands alone without a milestone when no section takes one: the empty project', () => {
    expect(looseGhost([], ALL)).toBe(true)
    expect(looseGhost([{ milestone: null, blocks: [item(false)] }], ALL)).toBe(true)
    expect(looseGhost([{ milestone: 'v0.1', blocks: [item(true)] }], ALL)).toBe(false)
    expect(looseGhost([], { requiredMilestones: ['v0.3'], excludedMilestones: [] })).toBe(false)
  })
})

describe('what the made task gets', () => {
  it('is Todo with its group milestone in the chain, Backlog without one in the backlog', () => {
    expect(chainPlace('v0.3')).toEqual({ status: 'Todo', milestone: 'v0.3' })
    expect(chainPlace(null)).toEqual({ status: 'Todo', milestone: null })
    expect(BACKLOG_PLACE).toEqual({ status: 'Backlog', milestone: null })
  })

  it('keeps a draft per ghost: per project, place and milestone, whatever its case', () => {
    expect(draftKey('p1', chainPlace('v0.3'))).toBe(draftKey('p1', chainPlace('V0.3')))
    const keys = new Set([draftKey('p1', chainPlace('v0.3')), draftKey('p1', chainPlace(null)), draftKey('p1', BACKLOG_PLACE), draftKey('p2', BACKLOG_PLACE)])
    expect(keys.size).toBe(4)
  })
})

describe('emptyMilestones', () => {
  it('lists the project milestones no task carries, in their order, ignoring case', () => {
    expect(emptyMilestones(['v0.2', 'v0.3', 'v0.4'], ['V0.2', null, 'v0.2'])).toEqual(['v0.3', 'v0.4'])
    expect(emptyMilestones([], ['v0.2'])).toEqual([])
  })
})
