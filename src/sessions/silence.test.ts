import { describe, expect, it } from 'vitest'
import type { AgentEntry } from './agents.js'
import { hungEntry, silentRestart, TURN_HANG_MS, TURN_RESTART_MS } from './silence.js'

const now = Date.parse('2026-10-27T12:00:00Z')
const busy: AgentEntry = { sessionId: 'session', cwd: '/work', kind: 'test', startedAt: now - 3_600_000, pid: 123, status: 'busy' }

describe('silent turns', () => {
  it('dates silence before the hang threshold without making the session idle', () => {
    expect(hungEntry(busy, now - TURN_RESTART_MS, now)).toEqual({ ...busy, silentSince: now - TURN_RESTART_MS })
  })

  it('takes a live silent turn for hung at thirty minutes and keeps its process', () => {
    expect(hungEntry(busy, now - TURN_HANG_MS, now)).toEqual({ ...busy, status: 'idle', silentSince: now - TURN_HANG_MS, hungSince: now - TURN_HANG_MS })
  })

  it.each(['waiting', 'idle', 'shell'] as const)('does not treat %s as a silent working turn', (status) => {
    const entry = { ...busy, status }
    expect(hungEntry(entry, now - TURN_HANG_MS, now)).toEqual(entry)
  })

  it('requires five quiet minutes and confirmation of this session and this silence', () => {
    const since = new Date(now - TURN_RESTART_MS).toISOString()
    const confirmation = { sessionId: 'session', since }
    expect(silentRestart('session', since, confirmation, now)).toBe(true)
    expect(silentRestart('session', since, confirmation, now - 1)).toBe(false)
    expect(silentRestart('session', since, undefined, now)).toBe(false)
    expect(silentRestart('other', since, confirmation, now)).toBe(false)
    expect(silentRestart('session', new Date(now).toISOString(), confirmation, now)).toBe(false)
    expect(silentRestart('session', null, confirmation, now)).toBe(false)
  })
})
