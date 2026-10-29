import { describe, expect, it } from 'vitest'
import { lampOf, type AgentEntry } from '../sessions/agents.js'

describe('a refused OpenCode model', () => {
  it('shows a waiting lamp after failure without a red session error', () => {
    const entry = { state: 'failed', status: 'idle', resting: true, startedAt: Date.now() } as AgentEntry
    expect(lampOf(entry, 'model')).toBe('waiting')
    expect(lampOf(entry, 'error')).toBe('error')
  })
})
