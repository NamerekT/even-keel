import { describe, expect, it } from 'vitest'
import type { AgentEntry } from './agents.js'
import { TurnEnds } from './turn-ends.js'

const entry = (sessionId: string, extra: Partial<AgentEntry> = {}): AgentEntry => ({
  id: sessionId,
  sessionId,
  kind: 'script',
  cwd: 'D:/repo/.claude/worktrees/abc-1',
  startedAt: 0,
  pid: 4242,
  ...extra,
})
const ids = (list: AgentEntry[]) => list.map((agent) => agent.sessionId)

describe('TurnEnds (BTN-1274)', () => {
  it('names a session once, when its turn ends', () => {
    const turns = new TurnEnds()
    expect(ids(turns.ended([entry('s1', { status: 'busy' })]))).toEqual([])
    expect(ids(turns.ended([entry('s1', { status: 'idle' })]))).toEqual(['s1'])
    expect(ids(turns.ended([entry('s1', { status: 'idle' })]))).toEqual([])
    expect(ids(turns.ended([entry('s1', { status: 'busy' })]))).toEqual([])
    expect(ids(turns.ended([entry('s1', { status: 'waiting' })]))).toEqual(['s1'])
  })

  it('takes a background command for the turn still going', () => {
    const turns = new TurnEnds()
    turns.ended([entry('s1', { status: 'busy' })])
    expect(ids(turns.ended([entry('s1', { status: 'shell' })]))).toEqual([])
    expect(ids(turns.ended([entry('s1', { status: 'idle' })]))).toEqual(['s1'])
  })

  it('names a live session first seen between turns, so work from before a restart is not missed', () => {
    const turns = new TurnEnds()
    expect(ids(turns.ended([entry('s1', { status: 'idle' }), entry('s2', { status: 'busy' })]))).toEqual(['s1'])
  })

  it('names a session that died mid-turn, but not one first seen dead', () => {
    const turns = new TurnEnds()
    turns.ended([entry('s1', { status: 'busy' })])
    const dead = { pid: undefined, status: 'busy' as const }
    expect(ids(turns.ended([entry('s1', dead), entry('s2', dead)]))).toEqual(['s1'])
    expect(ids(turns.ended([entry('s1', dead), entry('s2', dead)]))).toEqual([])
  })

  it('takes a Codex session resting between turns for a live one', () => {
    const turns = new TurnEnds()
    expect(ids(turns.ended([entry('s1', { pid: undefined, resting: true, status: 'idle' })]))).toEqual(['s1'])
  })
})
