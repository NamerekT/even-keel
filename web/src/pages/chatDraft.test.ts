import { describe, expect, it } from 'vitest'
import { isBlank, knownSessions, staleDrafts, type SavedDraft } from './chatDraft.js'

const NOW = Date.parse('2026-10-22T12:00:00.000Z')
const HOUR = 3_600_000

const saved = (sessionId: string, hoursAgo: number): Pick<SavedDraft, 'sessionId' | 'savedAt'> => ({ sessionId, savedAt: NOW - hoursAgo * HOUR })

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

describe('staleDrafts', () => {
  it('drops the drafts of sessions the state no longer has', () => {
    expect(staleDrafts([saved('gone', 48), saved('live', 48)], new Set(['live']), NOW)).toEqual(['gone'])
  })

  it('keeps a fresh draft of an unknown session: the state may not have read it yet', () => {
    expect(staleDrafts([saved('new', 1)], new Set(), NOW)).toEqual([])
  })

  it('keeps an old draft of a known session', () => {
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
