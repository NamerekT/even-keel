import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AccountHome } from '../account/homes.js'
import type { SessionTail } from '../agent/contract.js'
import { SESSION_WINDOWS_KEPT } from '../storage/context-windows.js'
import { TranscriptFold } from './transcript.js'
import type { AgentEntry } from './agents.js'
import { SessionMonitor } from './monitor.js'

let monitor: SessionMonitor | undefined
beforeEach(() => vi.useFakeTimers())
afterEach(async () => {
  await monitor?.stop()
  vi.useRealTimers()
})

function rig(sessionWindows?: [string, number][]) {
  const batches: [string, number][][] = []
  let entries: AgentEntry[] = []
  const home: AccountHome = { key: 'global', dir: '/account', global: true, agent: 'claude' }
  const summary = new TranscriptFold().summary()
  const tail: SessionTail = { path: undefined, follow: () => {}, read: async () => {}, summary: () => summary }
  const error = vi.fn()
  monitor = new SessionMonitor({
    homes: () => [home], agentOf: () => ({ sessions: async () => entries, tail: () => tail }),
    emailOf: () => null, apiKey: () => false, projectKeys: () => ['ABC'], intervalMs: 10,
    contextWindow: () => 250_000, onAgents: () => {}, onChange: () => {}, onError: error,
    sessionWindows, onSessionWindows: (windows) => batches.push(windows),
  })
  monitor.start()
  return {
    monitor, batches,
    async poll(count: number, from = 1) {
      entries = Array.from({ length: count }, (_, i) => ({
        sessionId: `session-${from + i}`, cwd: '/repo', kind: 'sdk' as const, name: `ABC-${from + i}`, model: 'opus',
        startedAt: Date.now(), resting: true, status: 'idle' as const,
      }))
      await vi.advanceTimersByTimeAsync(10)
      expect(error).not.toHaveBeenCalled()
    },
  }
}

const MANY = SESSION_WINDOWS_KEPT + 300

it('writes the windows of more sessions than it keeps once, in one batch, and nothing on an unchanged poll', async () => {
  const r = rig()
  await r.poll(MANY)
  expect(r.batches).toHaveLength(1)
  expect(r.batches[0]).toHaveLength(MANY)
  await r.poll(MANY)
  await r.poll(MANY)
  expect(r.batches).toHaveLength(1)
  expect(r.monitor.contextWindowOf('session-1')).toBe(250_000)
})

it('forgets the oldest sessions past the limit only once the page no longer shows them', async () => {
  const r = rig([['gone-1', 100_000], ['gone-2', 100_000]])
  await r.poll(SESSION_WINDOWS_KEPT - 2)
  expect(r.monitor.contextWindowOf('gone-1')).toBe(100_000)
  await r.poll(SESSION_WINDOWS_KEPT - 1)
  expect(r.monitor.contextWindowOf('gone-1')).toBeNull()
  expect(r.monitor.contextWindowOf('gone-2')).toBe(100_000)
  expect(r.monitor.contextWindowOf('session-1')).toBe(250_000)
})
