import { describe, expect, it } from 'vitest'
import { fakeTask } from '../../src/tracker/fixture.js'
import type { ParentTask, TaskMilestone } from '../../src/tracker/model.js'
import type { EvenKeelState, SessionView } from '../../src/state.js'
import { chainCalls, chainTo, hasParents, parentBlocks, parentsTo, parentView } from './parents.js'
import type { ChainBlock } from './state.js'

const done = { name: 'Done', category: 'Won' as const }
const milestone = (label: string): TaskMilestone => ({ label, targetDate: null })

function parent(id: string, fields: Partial<ParentTask> = {}): ParentTask {
  return { ...fakeTask(id, { subtasks: 5 }), closedSubtasks: 0, ...fields }
}

function stateOf(parents: ParentTask[], sessions: Partial<SessionView>[] = []) {
  return {
    parents: { p1: parents },
    sessions: sessions as SessionView[],
    taskSessions: { 'ABC-3': [{ sessionId: 's-old', at: '2026-11-11T10:00:00Z' }] },
    chain: { projects: { p1: { order: [], waiting: [], backlog: [], error: null, milestones: [{ label: 'v0.3', fresh: false }, { label: 'v0.4', fresh: false }] } } },
  } as unknown as Pick<EvenKeelState, 'parents' | 'sessions' | 'taskSessions' | 'chain'>
}

describe('parentBlocks', () => {
  it('puts the closed parents first for the archive, then the open ones by the milestones of the chain', () => {
    const state = stateOf([
      parent('ABC-9', { milestone: milestone('v0.4') }),
      parent('ABC-7', { status: done }),
      parent('ABC-3', { milestone: milestone('v0.3') }),
      parent('ABC-12'),
      parent('ABC-5', { milestone: milestone('v0.3') }),
    ])
    expect(parentBlocks(state, 'p1').map((block) => [block.id, block.lamp])).toEqual([
      ['ABC-7', 'done'],
      ['ABC-3', 'ahead'],
      ['ABC-5', 'ahead'],
      ['ABC-9', 'ahead'],
      ['ABC-12', 'ahead'],
    ])
  })

  it('shows a row out of the chain order with its sessions and the count of its closed subtasks', () => {
    const session = { task: 'ABC-3', sessionId: 's-1', lamp: 'waiting' as const, checkpoint: false }
    const [block] = parentBlocks(stateOf([parent('ABC-3', { closedSubtasks: 3 })], [session]), 'p1')
    expect(block).toMatchObject({ open: false, locked: false, current: false, subtasks: { closed: 3, total: 5 }, lamp: 'waiting' })
    expect(block!.session?.sessionId).toBe('s-1')
    expect(block!.sessions.map((run) => run.sessionId)).toEqual(['s-old'])
  })

  it('is empty for a project without parents', () => {
    expect(parentBlocks(stateOf([]), 'p2')).toEqual([])
  })
})

describe('parentView', () => {
  it('opens the parents only while the project has some', () => {
    expect(parentView('?view=parents', true)).toBe(true)
    expect(parentView('?view=parents', false)).toBe(false)
    expect(parentView('?task=ABC-1', true)).toBe(false)
  })

  it('knows a project with parents', () => {
    expect(hasParents(stateOf([parent('ABC-1')]), 'p1')).toBe(true)
    expect(hasParents(stateOf([]), 'p1')).toBe(false)
  })
})

describe('chainCalls', () => {
  const block = (fields: Partial<ChainBlock>) => ({ current: false, lamp: 'ahead', ...fields }) as ChainBlock

  it('calls while the chain is paused or its current task waits for a reply', () => {
    expect(chainCalls([block({ current: true, lamp: 'working' })], { kind: 'paused', error: null })).toBe(true)
    expect(chainCalls([block({ current: true, lamp: 'waiting' })], { kind: 'running', limitUntil: null })).toBe(true)
  })

  it('stays quiet for a running chain and for a waiting task that is not the current one', () => {
    expect(chainCalls([block({ current: true, lamp: 'working' }), block({ lamp: 'waiting' })], { kind: 'running', limitUntil: null })).toBe(false)
    expect(chainCalls([], { kind: 'idle' })).toBe(false)
  })
})

describe('parentsTo and chainTo', () => {
  it('keep the rest of the address and swap only the view', () => {
    expect(parentsTo('?card=ABC-1', 'ABC-3')).toEqual({ search: 'card=ABC-1&view=parents', hash: 'ABC-3' })
    expect(chainTo('?card=ABC-1&view=parents')).toEqual({ search: 'card=ABC-1', hash: '' })
  })
})
