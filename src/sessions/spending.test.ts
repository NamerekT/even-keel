import { describe, expect, it, vi } from 'vitest'
import type { AccountHome } from '../account/homes.js'
import type { SessionTail } from '../agent/contract.js'
import { SessionMonitor } from './monitor.js'
import { TranscriptFold } from './transcript.js'

describe('monitoring a spending refusal', () => {
  function monitorOf(line: Record<string, unknown>, apiKey: boolean) {
    const fold = new TranscriptFold()
    fold.push(JSON.stringify({ type: 'assistant', timestamp: '2026-10-25T10:00:00Z', gitBranch: 'abc-1/task', isApiErrorMessage: true, ...line }))
    const tail: SessionTail = { path: undefined, follow: () => {}, read: async () => {}, summary: () => fold.summary() }
    const home: AccountHome = { key: 'global', configDir: 'D:/fake/account', global: true, agent: 'claude' }
    const error = vi.fn()
    const monitor = new SessionMonitor({
      homes: () => [home], emailOf: () => null, apiKey: () => apiKey, projectKeys: () => ['ABC'], intervalMs: 60_000,
      agentOf: () => ({
        sessions: async () => [{ sessionId: 'fake-session', cwd: 'D:/work/abc', kind: 'sdk', name: 'ABC-1', startedAt: Date.now(), resting: true, status: 'idle' }],
        tail: () => tail,
      }),
      onAgents: () => {}, onChange: () => {}, onError: error,
    })
    monitor.start()
    return { monitor, error }
  }

  it.each([true, false])('holds the session only for an API account (%s)', async (apiKey) => {
    const { monitor, error } = monitorOf({
      error: 'unknown', apiErrorStatus: 400,
      message: { role: 'assistant', content: [{ type: 'text', text: 'API Error: 400 You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.' }] },
    }, apiKey)
    try {
      await vi.waitFor(() => expect(monitor.views()).toHaveLength(1))
      expect(error).not.toHaveBeenCalled()
      expect(monitor.views()[0]).toMatchObject({ lamp: 'limit', apiErrorKind: 'spend' })
      if (apiKey) expect(monitor.limited('ABC-1')?.limit).toMatchObject({ text: expect.stringContaining('2026-11-01') })
      else expect(monitor.limited('ABC-1')).toBeUndefined()
      if (apiKey) expect(monitor.limited('ABC-1')?.limit.credit).toBeUndefined()
    } finally {
      await monitor.stop()
    }
  })

  it('marks a hold on spent credit, so its handover is journaled as credit', async () => {
    const { monitor } = monitorOf({
      error: 'billing_error', apiErrorStatus: 400,
      message: { role: 'assistant', content: [{ type: 'text', text: 'Credit balance is too low' }] },
    }, true)
    try {
      await vi.waitFor(() => expect(monitor.views()).toHaveLength(1))
      expect(monitor.views()[0]).toMatchObject({ apiErrorKind: 'credit' })
      expect(monitor.limited('ABC-1')?.limit).toMatchObject({ text: 'Credit balance is too low', credit: true })
    } finally {
      await monitor.stop()
    }
  })
})
