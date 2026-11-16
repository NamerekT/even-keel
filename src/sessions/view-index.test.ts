import { describe, expect, it } from 'vitest'
import type { SessionView } from '../state.js'
import type { AgentEntry } from './agents.js'
import { agentOfSession, liveViewOf, steers, viewOf } from './view-index.js'

const view = (patch: Partial<SessionView>): SessionView => ({ task: 'ABC-1', sessionId: 's1', lamp: 'working', ...patch }) as SessionView
const agent = (patch: Partial<AgentEntry>): AgentEntry => ({ sessionId: 's1', cwd: '/repo', ...patch }) as AgentEntry

/** A list that counts how often it is walked. */
function counted<T>(items: T[]): { list: T[]; walks: () => number } {
  let walks = 0
  const list = [...items]
  const walk = list[Symbol.iterator].bind(list)
  list[Symbol.iterator] = () => {
    walks += 1
    return walk()
  }
  return { list, walks: () => walks }
}

describe('the views of the sessions by task (BTN-1254)', () => {
  it('gives a task\'s first view that has not finished, as find over the list does', () => {
    const list = [
      view({ task: 'ABC-1', sessionId: 'old', lamp: 'finished' }),
      view({ task: 'ABC-1', sessionId: 'live', lamp: 'waiting' }),
      view({ task: 'ABC-1', sessionId: 'later', lamp: 'working' }),
      view({ task: 'ABC-2', sessionId: 'done', lamp: 'finished' }),
    ]
    expect(liveViewOf(list, 'ABC-1')?.sessionId).toBe('live')
    expect(liveViewOf(list, 'ABC-2')).toBeUndefined()
    expect(viewOf(list, 'ABC-2', 'done')?.lamp).toBe('finished')
    expect(viewOf(list, 'ABC-1', 'done')).toBeUndefined()
  })

  it('walks a list once however many tasks ask, and a new list anew', () => {
    const first = counted(Array.from({ length: 1000 }, (_, index) => view({ task: `ABC-${index}`, sessionId: `s${index}`, lamp: 'finished' })))
    for (let index = 0; index < 1000; index++) {
      liveViewOf(first.list, `ABC-${index}`)
      viewOf(first.list, `ABC-${index}`, `s${index}`)
    }
    expect(first.walks()).toBe(1)
    const next = counted([view({ task: 'ABC-1', lamp: 'working' })])
    expect(liveViewOf(next.list, 'ABC-1')?.sessionId).toBe('s1')
    expect(next.walks()).toBe(1)
  })
})

describe('the agents by session (BTN-1254)', () => {
  it('gives a session\'s first agent and whether any of its agents steers', () => {
    const list = counted([agent({ sessionId: 's1', id: 'a' }), agent({ sessionId: 's1', id: 'b', steers: true }), agent({ sessionId: 's2', id: 'c' })])
    expect(agentOfSession(list.list, 's1')?.id).toBe('a')
    expect(steers(list.list, 's1')).toBe(true)
    expect(steers(list.list, 's2')).toBe(false)
    expect(agentOfSession(list.list, 's3')).toBeUndefined()
    expect(list.walks()).toBe(1)
  })
})
