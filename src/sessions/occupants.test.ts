import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentEntry } from './agents.js'
import { slotOccupants } from './occupants.js'

const slot = join(tmpdir(), 'abc', '.claude', 'worktrees', 'even-keel')
const agent = (sessionId: string, extra: Partial<AgentEntry> = {}): AgentEntry => ({
  id: `agent-${sessionId}`,
  cwd: slot,
  kind: 'bg',
  startedAt: 0,
  sessionId,
  ...extra,
})
const owners = new Map([
  ['s6', 'ABC-6'],
  ['s7', 'ABC-7'],
  ['s8', 'ABC-8'],
])

describe('slotOccupants', () => {
  it('splits live sessions of other tasks in the slot into idle and mid-turn ones', () => {
    const agents = [
      agent('s6', { status: 'idle', state: 'done' }),
      agent('s8', { status: 'busy', cwd: join(slot, 'src') }),
      agent('s9', { status: 'waiting' }),
    ]
    expect(slotOccupants(agents, owners, slot, 'ABC-7')).toEqual({
      idle: [{ agent: agents[0], task: 'ABC-6' }],
      busy: [{ agent: agents[1], task: 'ABC-8' }],
    })
  })

  it('leaves out the task’s own sessions, sessions elsewhere, stopped or failed ones and ones without an agent id', () => {
    const agents = [
      agent('s7', { status: 'busy' }),
      agent('s6', { cwd: join(tmpdir(), 'abc') }),
      agent('s8', { state: 'stopped' }),
      agent('s8', { state: 'failed', status: 'busy' }),
      agent('s6', { id: undefined }),
    ]
    expect(slotOccupants(agents, owners, slot, 'ABC-7')).toEqual({ idle: [], busy: [] })
  })

  it('counts a waiting session of another task as mid-turn', () => {
    const agents = [agent('s6', { status: 'waiting' })]
    expect(slotOccupants(agents, owners, slot, 'ABC-7').busy).toHaveLength(1)
  })

  it('counts a session with a background command running as mid-turn, so its slot is not taken from under it', () => {
    const agents = [agent('s6', { status: 'shell' })]
    expect(slotOccupants(agents, owners, slot, 'ABC-7').busy).toHaveLength(1)
  })
})
