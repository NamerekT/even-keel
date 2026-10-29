import { describe, expect, it } from 'vitest'
import { overageLimit } from './overage.js'
import type { RateLimits } from './model.js'

const at = '2026-10-29T10:00:00.000Z'
const now = new Date(at)
const reset = '2026-10-29T11:00:00.000Z'
const limits = (changes: Partial<RateLimits> = {}): RateLimits => ({
  fiveHour: { usedPercentage: 100, resetsAt: reset }, sevenDay: null, source: 'api', updatedAt: at, ...changes,
})
const entry = { agent: 'claude', working: true, needsLogin: false, apiKey: false }
const detect = (agent: string, data: RateLimits) => overageLimit({ ...entry, agent, limits: data }, now)

describe('stopping subscription overage', () => {
  it('accepts a fresh direct SDK report even without a reset or a usage window', () => {
    expect(detect('claude', limits({ fiveHour: null, source: 'sdk', overage: { source: 'claude-sdk', updatedAt: at, using: true } }))).toBe(at)
  })

  it('accepts Claude usage exhaustion and every supported credits or quota source', () => {
    expect(detect('claude', limits({ source: 'usage' }))).toBe(at)
    for (const agent of ['codex', 'opencode']) {
      expect(detect(agent, limits({ pool: 'chatgpt:example', overage: { source: 'chatgpt', updatedAt: at, available: true } }))).toBe(at)
    }
    for (const agent of ['copilot', 'opencode']) {
      expect(detect(agent, limits({ fiveHour: null, month: { usedPercentage: 100, left: 0, resetsAt: reset },
        overage: { source: 'github-quota', updatedAt: at, enabled: true, count: 0 } }))).toBe(at)
    }
  })

  it('requires fresh windows and facts independently, including the exact ten minute boundary', () => {
    const credits = limits({ overage: { source: 'chatgpt', updatedAt: at, available: true } })
    expect(overageLimit({ ...entry, agent: 'codex', limits: credits }, new Date('2026-10-29T10:10:00.000Z'))).toBe(at)
    expect(overageLimit({ ...entry, agent: 'codex', limits: credits }, new Date('2026-10-29T10:10:00.001Z'))).toBeNull()
    expect(detect('codex', { ...credits, updatedAt: '2026-10-29T09:49:59.999Z' })).toBeNull()
    expect(detect('codex', { ...credits, overage: { ...credits.overage!, updatedAt: '2026-10-29T09:49:59.999Z' } })).toBeNull()
  })

  it('rejects idle, key and signed-out accounts and unavailable, historical or unknown evidence', () => {
    const direct = limits({ overage: { source: 'claude-sdk', updatedAt: at, using: true } })
    for (const changes of [{ working: false }, { apiKey: true }, { needsLogin: true }]) {
      expect(overageLimit({ ...entry, ...changes, limits: direct }, now)).toBeNull()
    }
    for (const extra of [undefined, { source: 'github-billing' as const, updatedAt: at, used: 20 },
      { source: 'github-quota' as const, updatedAt: at, count: 50, enabled: false },
      { source: 'chatgpt' as const, updatedAt: at, available: false, balance: 20 }]) {
      expect(detect('opencode', limits({ overage: extra }))).toBeNull()
    }
    expect(detect('opencode', limits())).toBeNull()
    expect(detect('claude', limits({ source: 'statusline' }))).toBeNull()
    expect(detect('claude', { ...direct, overage: { ...direct.overage!, updatedAt: 'invalid' } })).toBeNull()
    expect(detect('claude', { ...direct, overage: { ...direct.overage!, updatedAt: reset } })).toBeNull()
  })

  it('requires an exhausted future window for indirect evidence; a balance alone never stops work', () => {
    const extra = { source: 'chatgpt' as const, updatedAt: at, available: true, balance: 20 }
    for (const fiveHour of [null, { usedPercentage: 99, resetsAt: reset }, { usedPercentage: 100, resetsAt: at }]) {
      expect(detect('codex', limits({ fiveHour, overage: extra }))).toBeNull()
    }
    expect(detect('codex', limits({ fiveHour: null, sevenDay: { usedPercentage: 100, resetsAt: reset }, overage: extra }))).toBe(at)
  })
})
