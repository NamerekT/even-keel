import { describe, expect, it } from 'vitest'
import type { AgentEntry } from './agents.js'
import { Lingering } from './lingering.js'

const entry = (sessionId: string, extra: Partial<AgentEntry> = {}): AgentEntry => ({
  id: sessionId,
  sessionId,
  kind: 'script',
  cwd: 'D:/repo/.claude/worktrees/abc-1',
  startedAt: 0,
  name: 'ABC-1',
  account: 'global',
  ...extra,
})
const busy = (agent: AgentEntry) => agent.status === 'busy' || agent.status === 'waiting'

describe('Lingering', () => {
  it('holds a kept session while its turn runs and gives it once the turn ends', () => {
    const lingering = new Lingering()
    lingering.keep('ABC-1', 'session-1')
    expect(lingering.due([entry('session-1', { pid: 1, status: 'busy' })], busy)).toEqual([])

    const rested = entry('session-1', { status: 'idle', resting: true })
    expect(lingering.due([rested], busy)).toEqual([{ task: 'ABC-1', agent: rested }])
    expect(lingering.due([rested], busy)).toEqual([])
  })

  it('does not give a session that waits for a reply', () => {
    const lingering = new Lingering()
    lingering.keep('ABC-1', 'session-1')
    expect(lingering.due([entry('session-1', { pid: 1, status: 'waiting' })], busy)).toEqual([])
  })

  it('forgets a kept session that is gone or ended on its own', () => {
    const lingering = new Lingering()
    lingering.keep('ABC-1', 'session-1')
    lingering.keep('ABC-1', 'session-2')
    expect(lingering.due([entry('session-2', { state: 'stopped' })], busy)).toEqual([])
    expect(lingering.due([entry('session-1', { status: 'idle', resting: true }), entry('session-2', { status: 'idle', resting: true })], busy)).toEqual([])
  })
})
