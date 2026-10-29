import { afterEach, describe, expect, it, vi } from 'vitest'
import { LimitsWatcher } from './watcher.js'
import { limitRecovery } from './recovery.js'
import { OVERAGE_LIMIT_TEXT, overageLimit } from './overage.js'
import type { RateLimits } from './model.js'
import { overageSession } from './overage-session.js'
import type { AccountEntry } from '../account/model.js'

const at = '2026-10-29T10:00:00.000Z'
const now = new Date(at)
const reset = '2026-10-29T11:00:00.000Z'
const data = (pool: string, updatedAt = at): RateLimits => ({ pool, updatedAt, source: 'api', fiveHour: { usedPercentage: 99, resetsAt: reset }, sevenDay: null })

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

describe('paid usage scope and recovery', () => {
  it('shares included windows and credits across Codex and OpenCode of the same ChatGPT pool', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(now)
    const readings: Record<string, RateLimits> = {
      codex: { ...data('chatgpt:example'), fiveHour: { usedPercentage: 100, resetsAt: reset }, overage: { source: 'chatgpt', updatedAt: at, available: true, balance: 12 } },
      opencode: data('chatgpt:example', '2026-10-29T09:55:00.000Z'), other: data('chatgpt:other'),
    }
    let notBefore: string | null = null
    const watcher = new LimitsWatcher({
      file: '/nonexistent/limits.json', intervalMs: 60_000, usageIntervalMs: 300_000, offlineRetryMs: 30_000,
      homes: () => Object.keys(readings).map((key) => ({ key, dir: `/fake/${key}`, global: false, agent: key === 'codex' ? 'codex' : 'opencode' })),
      ownerOf: () => undefined, usage: (home) => async () => ({ kind: 'limits', limits: readings[home.key]! }),
      online: async () => true, notBefore: (key) => key === 'codex' ? notBefore : null,
      accessExpired: () => false, ready: () => true, apiKey: () => false, needsLogin: () => false,
      onChange: () => {}, onError: (error) => { throw error },
    })
    watcher.refresh()
    for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve))
    expect(watcher.limits('opencode')).toMatchObject({ fiveHour: { usedPercentage: 100 }, overage: { balance: 12 } })
    expect(overageLimit({ agent: 'opencode', needsLogin: false, apiKey: false, working: true, limits: watcher.limits('opencode') }, now)).toBe(at)
    expect(watcher.limits('other')?.fiveHour?.usedPercentage).toBe(99)
    notBefore = '2026-10-29T10:00:01.000Z'
    expect(watcher.limits('opencode')?.fiveHour?.usedPercentage).toBe(99)
  })

  it('does not invent a reset for a paid-usage stop when the ordinary unknown-limit path would retry', () => {
    const recovery = limitRecovery({ homeOf: () => undefined, agentOf: () => ({}), apiKey: () => false,
      creditBackAfter: () => { throw new Error('subscription must not probe credit') }, limits: () => null,
      usage: () => ({ state: 'stale', reason: null, since: at }) })
    expect(recovery.retryAfterLimit('global', at, OVERAGE_LIMIT_TEXT)).toBeNull()
    expect(recovery.retryAfterLimit('global', at, 'rate limit')).toBe('2026-10-29T10:15:00.000Z')
  })

  it('uses the own session liveness instead of another session working on the same account', () => {
    const account = { key: 'global', agent: 'claude', apiKey: false, needsLogin: false, working: true,
      limits: { ...data('unused'), source: 'sdk', overage: { source: 'claude-sdk', using: true, updatedAt: at } } } as AccountEntry
    const session = { sessionId: 'owned', agentId: 'owned', account: 'global', cwd: '/fake', workdir: '/fake', branch: null,
      transcript: null, lastReplyAt: null, recent: [], lastMessage: null, checkpoint: null }
    const agent = { sessionId: 'owned', kind: 'sdk', cwd: '/fake', startedAt: now.getTime(), resting: true, status: 'busy' as const }
    expect(overageSession(session, agent, account, now)?.sessionId).toBe('owned')
    expect(overageSession(session, { ...agent, resting: false }, account, now)).toBeUndefined()
    expect(overageSession(session, { ...agent, status: 'idle' }, account, now)).toBeUndefined()
    expect(overageSession(session, { ...agent, sessionId: 'external' }, account, now)).toBeUndefined()
  })
})
