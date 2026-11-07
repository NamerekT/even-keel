import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionTail } from '../agent/contract.js'
import { SessionMonitor } from './monitor.js'
import type { AgentEntry } from './agents.js'
import { TranscriptFold } from './transcript.js'

afterEach(() => vi.restoreAllMocks())

describe('rare events at the monitor decision', () => {
  it('logs a blocked shell only when accepted as waiting, once for each CLI turn', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const entry: AgentEntry = { id: 'job', sessionId: 'blocked-monitor', cwd: '/repo', kind: 'bg', name: 'ABC-1',
      startedAt: Date.now() - 400_000, pid: 123, status: 'shell', state: 'blocked',
      backgroundBlock: { event: 'turn-1', detail: 'Press the button\nbehind the monitor' } }
    const fold = new TranscriptFold()
    const tail: SessionTail = { path: undefined, follow: () => {}, read: async () => {}, summary: () => fold.summary() }
    const monitor = new SessionMonitor({
      agentOf: () => ({ sessions: async () => [entry], tail: () => tail }),
      homes: () => [{ key: 'global', dir: '/account', global: true, agent: 'claude' }],
      emailOf: () => null, apiKey: () => false, projectKeys: () => ['ABC'], intervalMs: 10,
      onAgents: () => {}, onChange: () => {}, onError: (error) => { throw error },
    })
    const rare = () => log.mock.calls.filter(([line]) => String(line).startsWith('rare: 46'))
    monitor.start()
    try {
      await vi.waitFor(() => expect(rare()).toHaveLength(1))
      expect(monitor.views()[0]?.lamp).toBe('waiting')
      expect(rare()[0]![0]).toContain('detail="Press the button\\nbehind the monitor"')
      entry.backgroundBlock = { event: 'turn-2', detail: null }
      entry.status = 'busy'
      await vi.waitFor(() => expect(monitor.views()[0]?.lamp).toBe('working'))
      expect(rare()).toHaveLength(1)
      entry.status = 'shell'
      await vi.waitFor(() => expect(rare()).toHaveLength(2))
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(rare()).toHaveLength(2)
    } finally { await monitor.stop() }
  })
})
