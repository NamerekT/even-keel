import { describe, expect, it } from 'vitest'
import { draftKey, isBlank, knownSessions, knownTasks, staleDrafts } from './chatDraft.js'

const NOW = Date.parse('2026-10-22T12:00:00.000Z')
const HOUR = 3_600_000

const saved = (id: string, hoursAgo: number) => ({ id, savedAt: NOW - hoursAgo * HOUR })

describe('isBlank', () => {
  it('is blank without text and files', () => {
    expect(isBlank({ text: '', files: [] })).toBe(true)
  })

  it('keeps whitespace a user typed only while there is something else', () => {
    expect(isBlank({ text: '  \n', files: [] })).toBe(true)
    expect(isBlank({ text: 'hello', files: [] })).toBe(false)
  })

  it('is not blank with a file alone', () => {
    expect(isBlank({ text: '', files: [new File(['x'], 'one.txt')] })).toBe(false)
  })
})

describe('draftKey', () => {
  it('names a task by its project, since a task key alone is not unique', () => {
    expect(draftKey('p1', 'ABC-1')).not.toBe(draftKey('p2', 'ABC-1'))
    expect(draftKey('p1', 'ABC-1')).toBe(draftKey('p1', 'ABC-1'))
  })
})

describe('staleDrafts', () => {
  it('drops the drafts of tasks or sessions the state no longer has', () => {
    expect(staleDrafts([saved('gone', 48), saved('live', 48)], new Set(['live']), NOW)).toEqual(['gone'])
  })

  it('keeps a fresh draft of an unknown one: the state may not have read it yet', () => {
    expect(staleDrafts([saved('new', 1)], new Set(), NOW)).toEqual([])
  })

  it('keeps an old draft of a known one', () => {
    expect(staleDrafts([saved('live', 24 * 30)], new Set(['live']), NOW)).toEqual([])
  })
})

describe('knownSessions', () => {
  it('takes the live sessions and those of every task', () => {
    const state = {
      sessions: [{ sessionId: 'a' }],
      taskSessions: { t1: [{ sessionId: 'b' }, { sessionId: 'c' }], t2: [] },
    }
    expect([...knownSessions(state)].sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('knownTasks', () => {
  it('takes the tasks of the state, closed ones too, and every task that had a session', () => {
    const state = {
      tasks: [{ id: 'A-1' }, { id: 'A-2' }],
      taskSessions: { 'A-3': [{ sessionId: 'b' }], 'fix-main-1': [] },
    }
    expect([...knownTasks(state)].sort()).toEqual(['A-1', 'A-2', 'A-3', 'fix-main-1'])
  })
})
