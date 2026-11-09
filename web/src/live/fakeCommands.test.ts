import { describe, expect, it } from 'vitest'
import type { EvenKeelState } from '../../../src/state.js'
import { closeCurrent, startChain } from './fakeCommands.js'
import { ago, session, task } from './fakeSessions.js'

function state(active: boolean): EvenKeelState {
  const first = session('ABC-5', 0).sessionId
  const second = session('ABC-6', 0).sessionId
  return {
    projects: ['ABC'],
    tasks: [task('ABC-5', 'First', 'In Progress', 'Active', [], null), task('ABC-6', 'Second', 'In Progress', 'Active', [], null)],
    chain: {
      active: active ? [{ project: 'ABC', current: { task: 'ABC-5', sessionId: first, since: ago(5) }, paused: false, error: null }] : [],
      queue: [],
      parallel: 1,
      projects: { ABC: { order: ['ABC-5', 'ABC-6'], waiting: [], backlog: [], error: null } },
    },
    sessions: [session('ABC-5', 10_000), session('ABC-6', 10_000, 'waiting')],
    launches: [],
    taskSessions: {
      'ABC-5': [{ sessionId: first, at: ago(40), how: 'manual', resumed: 0, answers: 0 }],
      'ABC-6': [{ sessionId: second, at: ago(60), how: 'manual', resumed: 0, answers: 0 }],
    },
  } as unknown as EvenKeelState
}

function ids(after: EvenKeelState, id: string): string[] {
  return (after.taskSessions[id] ?? []).map((row) => row.sessionId)
}

describe('fake chain commands', () => {
  it('lists the session of the next task once when the task already had it', () => {
    const after = closeCurrent(state(true))
    expect(after.chain.active[0]?.current?.task).toBe('ABC-6')
    expect(ids(after, 'ABC-6')).toEqual([session('ABC-6', 0).sessionId])
    expect(after.taskSessions['ABC-6']?.[0]?.how).toBe('launch')
  })

  it('lists the session of the first task once when a chain starts on a task that already had it', () => {
    const after = startChain(state(false), 'ABC', [])
    expect(ids(after, 'ABC-5')).toEqual([session('ABC-5', 0).sessionId])
  })
})
