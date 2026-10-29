import { expect, it, vi } from 'vitest'
import type { AccountHome } from '../account/homes.js'
import { CreditChecks } from '../account/credit.js'
import { holdOf } from '../chain/relay.js'
import { limitRecovery } from '../limits/recovery.js'
import { notice } from '../notice/notice.js'
import { SessionMonitor } from '../sessions/monitor.js'
import { foldSession } from './transcript.js'

it('holds an OpenCode API spending refusal until its UTC reset or a successful five-minute key check', async () => {
  const at = '2026-10-29T10:00:00.000Z'
  const text = 'You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.'
  const summary = foldSession([{
    id: 'msg_fake', at: Date.parse(at),
    data: JSON.stringify({ role: 'assistant', providerID: 'anthropic', modelID: 'claude-haiku-5-5',
      error: { name: 'APIError', data: { message: text, statusCode: 400, isRetryable: false } } }),
  }], [])
  const home: AccountHome = { key: 'api', dir: 'D:/fake/account', global: false, agent: 'opencode' }
  const error = vi.fn()
  const monitor = new SessionMonitor({
    homes: () => [home], emailOf: () => null, apiKey: () => true, projectKeys: () => ['ABC'], intervalMs: 60_000,
    agentOf: () => ({
      sessions: async () => [{ sessionId: 'fake-session', account: home.key, cwd: 'D:/work/abc', kind: 'sdk' as const,
        name: 'ABC-1', startedAt: Date.parse(at), resting: true, status: 'idle' as const }],
      tail: () => ({ path: undefined, follow: () => {}, read: async () => {}, summary: () => summary }),
    }),
    onAgents: () => {}, onChange: () => {}, onError: error,
  })
  monitor.start()
  try {
    await vi.waitFor(() => expect(monitor.views()).toHaveLength(1))
    expect(error).not.toHaveBeenCalled()
    const session = monitor.limited('ABC-1')
    expect(session?.limit).toEqual({ at, text })
    if (session === undefined) throw new Error('Spending refusal was not held')
    const checks = new CreditChecks(5 * 60_000)
    let now = new Date(at)
    const recovery = limitRecovery({
      homeOf: () => home, agentOf: () => ({}), apiKey: () => true,
      creditBackAfter: (key, since, refusal) => checks.restoredAfter(key, since, now, refusal),
      limits: () => null, usage: () => ({ kind: 'missing', reason: notice('usage.noLimits', {}) }),
    })
    const retry = () => recovery.retryAfterLimit(home.key, session.limit.at, session.limit.text)
    expect(retry()).toBeNull()
    expect(holdOf(session, home.key, retry()).resetsAt).toBe('2026-11-01T00:00:00.000Z')
    expect(checks.spendingLimit(home.key, now)).toEqual({ resetsAt: '2026-11-01T00:00:00.000Z' })
    now = new Date(Date.parse(at) + 5 * 60_000 - 1)
    expect(checks.due(now)).toEqual([])
    now = new Date(now.getTime() + 1)
    expect(checks.due(now)).toEqual([home.key])
    checks.note(home.key, { state: 'empty' }, now)
    expect(retry()).toBeNull()
    now = new Date(now.getTime() + 5 * 60_000)
    expect(checks.due(now)).toEqual([home.key])
    checks.note(home.key, { state: 'ok' }, now)
    expect(retry()).toBe(now.toISOString())
  } finally {
    await monitor.stop()
  }
})
