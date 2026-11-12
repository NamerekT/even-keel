import { describe, expect, it, vi } from 'vitest'
import { askCopilot, askCopilotToken, billingLimits, copilotLimits, COPILOT_USER_URL } from './copilot.js'

const AT = '2030-01-12T10:00:00.000Z'
const RESET = '2030-02-01T00:00:00.000Z'
// Synthetic fields from https://github.com/DamianEdwards/ghcp-spend-tray/blob/main/src/GHCPSpendTray.Core/JsonModels.cs
const CREDITS = { entitlement: 1000, credits_used: 250.5, unlimited: false, has_quota: true, token_based_billing: true }
const quota = (premium: object) => ({ quota_reset_date: '2030-02-01', quota_snapshots: { premium_interactions: premium } })
// Synthetic personal-plan fields from https://github.com/getpaseo/paseo/issues/8478
const PERSONAL = { entitlement: 1500, remaining: 1200, percent_remaining: 80, unlimited: false, overage_permitted: true, overage_count: 2 }
// Product and quantity fields: https://docs.github.com/en/rest/billing/usage#get-billing-ai-credit-usage-report-for-a-user
const BILLING = { usageItems: [{ product: 'Copilot AI Credits', grossQuantity: 25.5, netAmount: 0.25 }] }
const USER = 'https://api.github.com/user'
const PREMIUM = 'https://api.github.com/users/example/settings/billing/premium_request/usage'
const AI = 'https://api.github.com/users/example/settings/billing/ai_credit/usage'

function routes(premium: unknown, ai: unknown = BILLING, premiumStatus = 200, aiStatus = 200) {
  return vi.fn(async (url: string | URL | Request) => {
    if (String(url) === USER) return Response.json({ login: 'example' })
    if (String(url) === PREMIUM) return Response.json(premium, { status: premiumStatus })
    if (String(url) === AI) return Response.json(ai, { status: aiStatus })
    return Response.json({}, { status: 404 })
  })
}

describe('Copilot AI credits', () => {
  it('reads fractional credits spent out of the entitlement', () => {
    expect(copilotLimits(quota(CREDITS), AT)).toMatchObject({
      month: { left: 749.5, usedPercentage: 25.1, resetsAt: RESET }, updatedAt: AT, source: 'api',
    })
  })

  it('still reads the paid personal plan and its overage permission', () => {
    expect(copilotLimits(quota(PERSONAL), AT)).toMatchObject({
      month: { left: 1200, usedPercentage: 20 }, overage: { enabled: true, count: 2 },
    })
  })

  it('prefers remaining when both readings are present', () => {
    expect(copilotLimits(quota({ ...CREDITS, remaining: 600 }), AT)).toMatchObject({ month: { left: 600 } })
  })

  it.each([0, 1000, 1200])('clamps spending %s to the allowance', (used) => {
    expect(copilotLimits(quota({ ...CREDITS, credits_used: used }), AT)).toMatchObject({ month: { left: Math.max(0, 1000 - used) } })
  })

  it.each([NaN, Infinity, -1, '20', null])('rejects invalid credits %s', (used) => {
    expect(copilotLimits(quota({ ...CREDITS, credits_used: used }), AT)).toBeUndefined()
  })

  it.each([undefined, 0, -1, NaN, Infinity])('explains unavailable entitlement %s', async (entitlement) => {
    const fetchImpl = vi.fn(async () => Response.json(quota({ ...CREDITS, entitlement })))
    expect(await askCopilot('fake', AT, 1000, fetchImpl)).toMatchObject({ kind: 'missing', reason: { code: 'usage.copilotNoQuota' } })
    expect(await askCopilotToken('fake', AT, 1000, fetchImpl)).toMatchObject({ kind: 'missing', reason: { code: 'usage.copilotNoQuota' } })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('does not substitute chat or an unlimited reading for has_quota false', async () => {
    const body = { ...quota({ ...CREDITS, has_quota: false, unlimited: true }), limited_user_quotas: { chat: 10 }, monthly_quotas: { chat: 50 } }
    const fetchImpl = vi.fn(async () => Response.json(body))
    expect(await askCopilotToken('fake', AT, 1000, fetchImpl)).toMatchObject({ kind: 'missing', reason: { code: 'usage.copilotNoQuota' } })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('Copilot AI credit billing fallback', () => {
  it.each([200, 404])('tries AI credits after empty premium usage or HTTP %s', async (status) => {
    const fetchImpl = routes({ usageItems: [] }, BILLING, status)
    expect(await askCopilotToken('fake', AT, 1000, fetchImpl)).toMatchObject({ kind: 'limits', limits: {
      month: { used: 25.5, usedPercentage: 0, resetsAt: RESET }, overage: { source: 'github-billing', used: 0.25, unit: 'USD' },
    } })
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([COPILOT_USER_URL, USER, PREMIUM, AI])
  })

  it.each(['Copilot', 'Copilot AI Credits', 'AI credits'])('reads product %s', (product) => {
    expect(billingLimits({ usageItems: [{ product, grossQuantity: 12.5 }] }, AT)).toMatchObject({ month: { used: 12.5 } })
  })

  it('logs unknown products and tries credits instead of showing zero', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const fetchImpl = routes({ usageItems: [{ product: 'Other product', grossQuantity: 40 }] })
      expect(await askCopilotToken('fake', AT, 1000, fetchImpl)).toMatchObject({ kind: 'limits', limits: { month: { used: 25.5 } } })
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Other product'))
    } finally { warn.mockRestore() }
  })

  it('explains empty final reports and repeats the lookup on the next poll', async () => {
    const fetchImpl = routes({ usageItems: [] }, { usageItems: [] })
    for (let poll = 0; poll < 2; poll++) {
      expect(await askCopilotToken('fake', AT, 1000, fetchImpl)).toMatchObject({ kind: 'missing', reason: { code: 'usage.copilotBillingEmpty' } })
    }
    expect(fetchImpl).toHaveBeenCalledTimes(8)
  })

  it('keeps a real zero without querying a second source', async () => {
    const fetchImpl = routes({ usageItems: [{ product: 'Copilot', grossQuantity: 0 }] })
    expect(await askCopilotToken('fake', AT, 1000, fetchImpl)).toMatchObject({ kind: 'limits', limits: { month: { used: 0 } } })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it.each([403, 404])('keeps the permission explanation for final HTTP %s', async (status) => {
    expect(await askCopilotToken('fake', AT, 1000, routes({ usageItems: [] }, {}, 200, status)))
      .toMatchObject({ kind: 'missing', reason: { code: 'usage.planRead' } })
  })

  it('does not hide transient errors behind another endpoint', async () => {
    const fetchImpl = routes({}, {}, 500)
    await expect(askCopilotToken('fake', AT, 1000, fetchImpl)).rejects.toThrow('500')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('keeps malformed reports unread rather than treating them as empty', async () => {
    const fetchImpl = routes({ invalid: true })
    expect(await askCopilotToken('fake', AT, 1000, fetchImpl)).toMatchObject({ kind: 'unknown', reason: { code: 'usage.copilotUnread' } })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })
})
