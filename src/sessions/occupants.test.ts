import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentEntry } from './agents.js'
import { slotOccupants } from './occupants.js'

const slot = join(tmpdir(), 'abc', '.claude', 'worktrees', 'even-keel')
const agent = (sessionId: string, extra: Partial<AgentEntry> = {}): AgentEntry => ({
  id: `agent-${sessionId}`,
  pid: 100,
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

  it('leaves out the task’s own sessions, sessions elsewhere and ones without an agent id', () => {
    const agents = [agent('s7', { status: 'busy' }), agent('s6', { cwd: join(tmpdir(), 'abc') }), agent('s6', { id: undefined })]
    expect(slotOccupants(agents, owners, slot, 'ABC-7')).toEqual({ idle: [], busy: [] })
  })

  it('counts a stopped or failed session whose process still runs, so it is stopped before the slot is taken', () => {
    const agents = [agent('s6', { state: 'failed', status: 'idle' }), agent('s8', { state: 'stopped', status: 'idle' })]
    expect(slotOccupants(agents, owners, slot, 'ABC-7').idle).toHaveLength(2)
  })

  it('leaves out sessions with no live process, whatever state the agent list still shows for them', () => {
    const agents = [
      agent('s6', { pid: undefined, state: 'done' }),
      agent('s8', { pid: undefined, state: 'working' }),
      agent('s6', { pid: undefined, state: 'blocked' }),
    ]
    expect(slotOccupants(agents, owners, slot, 'ABC-7')).toEqual({ idle: [], busy: [] })
  })

  it('counts a session resting between turns as idle, so it is stopped before the slot is taken', () => {
    const resting = agent('s6', { pid: undefined, status: 'idle', resting: true })
    expect(slotOccupants([resting], owners, slot, 'ABC-7')).toEqual({ idle: [{ agent: resting, task: 'ABC-6' }], busy: [] })
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
