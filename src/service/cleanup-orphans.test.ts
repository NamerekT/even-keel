import { describe, expect, it, vi } from 'vitest'
import type { AgentEntry } from '../sessions/agents.js'
import { Lingering } from '../sessions/lingering.js'
import { stopLingering, stopTaskSessions } from './cleanup.js'

const place = '/repo/.claude/worktrees/abc-1'
const agent = (sessionId: string, status: AgentEntry['status'], cwd = place): AgentEntry =>
  ({ id: `job-${sessionId}`, sessionId, cwd, kind: 'bg', startedAt: 0, pid: 1234, status })

describe("the cleanup's sweep of orphaned processes (BTN-1268)", () => {
  it('looks for the processes of the gone and just stopped sessions of the task, never of a live one', async () => {
    const stopIn = vi.fn(async (_home: unknown, { sessionId }: { sessionId: string }) => { if (sessionId === 'refused') throw new Error('stop refused') })
    const journal = [{ task: 'ABC-1', sessionId: 'died-earlier' }, { task: 'ABC-1', sessionId: 'idle' }, { task: 'ABC-1', sessionId: 'busy' },
      { task: 'ABC-1', sessionId: 'refused' }, { task: 'ABC-1', sessionId: 'elsewhere' }, { task: 'ABC-2', sessionId: 'next' }]
    const agents = [agent('idle', 'idle'), agent('busy', 'busy'), agent('refused', 'idle'), agent('elsewhere', 'idle', '/repo'), agent('next', 'idle', '/repo/.claude/worktrees/abc-2')]
    const ctx = { agents, journal, lingering: new Lingering(), homeOf: () => ({}), stopIn } as unknown as Parameters<typeof stopTaskSessions>[0]
    const sweep = vi.fn(async () => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await stopTaskSessions(ctx, 'project-1', '/repo', 'ABC-1', 1, false, sweep)
    } finally { warn.mockRestore() }
    expect(sweep).toHaveBeenCalledWith(['died-earlier', 'idle'], 'ABC-1')
  })

  it('looks for the processes of a session stopped once its turn after Done ended', async () => {
    const busy = agent('late', 'busy')
    const ctx = { agents: [busy], journal: [], lingering: new Lingering(), homeOf: () => ({}), stopIn: vi.fn(async () => {}), agentsRead: false } as unknown as Parameters<typeof stopTaskSessions>[0]
    const sweep = vi.fn(async () => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await stopTaskSessions(ctx, 'project-1', '/repo', 'ABC-1', 1, false, sweep)
      expect(sweep).toHaveBeenLastCalledWith([], 'ABC-1')
      busy.status = 'idle'
      await stopLingering(ctx, undefined, sweep)
    } finally { log.mockRestore() }
    expect(sweep).toHaveBeenLastCalledWith(['late'], 'ABC-1')
  })
})
