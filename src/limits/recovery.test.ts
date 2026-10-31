import { describe, expect, it } from 'vitest'
import type { RateLimits } from './model.js'
import { limitRecovery } from './recovery.js'

const AT = '2026-10-31T21:05:00.000Z'
const RESET = '2026-11-01T00:00:00.000Z'
const polled: RateLimits = { fiveHour: null, sevenDay: null, month: { usedPercentage: 90.7, resetsAt: RESET, left: 28 }, updatedAt: '2026-10-31T21:03:00.000Z', source: 'api' }

function recoveryOf() {
  let limits: RateLimits | null = polled
  const spent: string[] = []
  const recovery = limitRecovery({
    homeOf: (key) => ({ key, dir: '/home/john/.copilot', global: false, agent: 'copilot' }),
    agentOf: () => ({ keyUsage: true }),
    apiKey: () => true,
    creditBackAfter: () => null,
    limits: () => limits,
    usage: () => ({ state: 'ok', reason: null, since: null }),
    spendMonth: (key, at) => {
      spent.push(key)
      limits = { ...polled, month: { ...polled.month!, usedPercentage: 100, left: 0 }, updatedAt: at }
    },
  })
  return { recovery, spent }
}

describe('limitRecovery', () => {
  it('takes a refusal of the monthly quota as the month spent, before the next poll', () => {
    const { recovery, spent } = recoveryOf()
    expect(recovery.retryAfterLimit('copilot-key', AT, 'You have exceeded your monthly quota')).toBe(RESET)
    expect(spent).toEqual(['copilot-key'])
  })

  it('keeps waiting for a poll after a rate limit', () => {
    const { recovery, spent } = recoveryOf()
    expect(recovery.retryAfterLimit('copilot-key', AT, 'You have hit the rate limit')).toBeNull()
    expect(spent).toEqual([])
  })
})
