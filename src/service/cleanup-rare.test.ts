import { describe, expect, it, vi } from 'vitest'
import type { AgentEntry } from '../sessions/agents.js'
import { Lingering } from '../sessions/lingering.js'
import { stopLingering, stopTaskSessions } from './cleanup.js'

describe('rare cleanup observations', () => {
  it.each(['busy', 'waiting'] as const)('reports one deferral for %s and its eventual stop result', async (status) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const agent: AgentEntry = { id: 'job', sessionId: `cleanup-${status}`, cwd: '/repo/.claude/worktrees/abc-1', kind: 'bg',
      startedAt: 0, pid: 1234, status }
    const stopIn = vi.fn(async () => { if (status === 'waiting') throw new Error('stop refused') })
    const ctx = { agents: [agent], launches: [], lingering: new Lingering(), homeOf: () => ({}), stopIn } as unknown as Parameters<typeof stopTaskSessions>[0]
    const rare = () => log.mock.calls.filter(([line]) => String(line).startsWith('rare: 17c'))
    try {
      await stopTaskSessions(ctx, 'project-1', '/repo', 'ABC-1', 1)
      await stopTaskSessions(ctx, 'project-1', '/repo', 'ABC-1', 1)
      await stopLingering(ctx)
      expect(stopIn).not.toHaveBeenCalled()
      expect(rare()).toHaveLength(1)
      expect(rare()[0]![0]).toContain(`cleanup-deferred status=${status}`)
      agent.status = 'idle'
      await stopLingering(ctx)
      await stopLingering(ctx)
      expect(stopIn).toHaveBeenCalledTimes(1)
      expect(rare()).toHaveLength(2)
      expect(rare()[1]![0]).toContain(`cleanup-stop result=${status === 'busy' ? 'stopped' : 'failed'}`)
      expect(rare()[1]![0]).toContain('project="project-1" task="ABC-1"')
    } finally { log.mockRestore(); warn.mockRestore() }
  })
})
