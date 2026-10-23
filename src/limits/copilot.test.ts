import { describe, expect, it, vi } from 'vitest'
import { askCopilot, askCopilotToken, billingLimits, copilotLimits, COPILOT_USER_URL } from './copilot.js'
import { notice } from '../notice/notice.js'

const AT = '2026-10-23T10:00:00.000Z'
const NEXT_MONTH = '2026-11-01T00:00:00.000Z'

const PRO = {
  login: 'octocat',
  copilot_plan: 'individual',
  quota_reset_date: '2026-11-01',
  quota_snapshots: {
    chat: { entitlement: 0, remaining: 0, percent_remaining: 100, unlimited: true, quota_id: 'chat' },
    completions: { entitlement: 0, remaining: 0, percent_remaining: 100, unlimited: true, quota_id: 'completions' },
    premium_interactions: { entitlement: 300, remaining: 120, percent_remaining: 40, unlimited: false, quota_id: 'premium_interactions' },
  },
}

const BILLING = {
  timePeriod: { year: 2026, month: 10 },
  user: 'octocat',
  usageItems: [
    { product: 'Copilot', sku: 'Copilot Premium Request', model: 'GPT-5', unitType: 'requests', grossQuantity: 40, discountQuantity: 40, netQuantity: 0 },
    { product: 'Copilot', sku: 'Copilot Premium Request', model: 'Claude Sonnet 4.6', unitType: 'requests', grossQuantity: 12.5, discountQuantity: 12.5, netQuantity: 0 },
    { product: 'Actions', sku: 'Actions Linux', unitType: 'minutes', grossQuantity: 999, discountQuantity: 999, netQuantity: 0 },
  ],
}

type Route = Record<string, { status: number; body: unknown }>

function routes(table: Route) {
  return vi.fn(async (url: string | URL | Request) => {
    const found = table[String(url)]
    return found === undefined ? new Response('{}', { status: 404 }) : new Response(JSON.stringify(found.body), { status: found.status })
  })
}

describe('copilotLimits', () => {
  it('reads the premium requests left of the allowance and its reset', () => {
    expect(copilotLimits(PRO, AT)).toEqual({
      fiveHour: null,
      sevenDay: null,
      month: { usedPercentage: 60, resetsAt: NEXT_MONTH, left: 120 },
      updatedAt: AT,
      source: 'api',
    })
  })

  it('takes another limited quota when premium requests are not one, never the completions', () => {
    const credits = {
      quota_reset_date_utc: '2026-11-01T00:00:00.000Z',
      quota_snapshots: {
        completions: { entitlement: 2000, remaining: 10, unlimited: false },
        ai_credits: { entitlement: 1000, remaining: 750, unlimited: false },
      },
    }
    expect(copilotLimits(credits, AT)?.month).toEqual({ usedPercentage: 25, resetsAt: NEXT_MONTH, left: 750 })
  })

  it('reads the free plan’s monthly chat quota', () => {
    const free = { limited_user_quotas: { chat: 30, completions: 1500 }, monthly_quotas: { chat: 50, completions: 2000 }, limited_user_reset_date: '2026-11-01' }
    expect(copilotLimits(free, AT)?.month).toEqual({ usedPercentage: 40, resetsAt: NEXT_MONTH, left: 30 })
  })

  it('tells an unlimited plan from an answer it cannot read', () => {
    const unlimited = { quota_snapshots: { chat: { unlimited: true }, premium_interactions: { unlimited: true } } }
    expect(copilotLimits(unlimited, AT)).toBe('unlimited')
    expect(copilotLimits({ login: 'octocat' }, AT)).toBeUndefined()
  })

  it('resets on the 1st of the next month when the answer gives no date', () => {
    const undated = { quota_snapshots: { premium_interactions: { entitlement: 300, remaining: 300, unlimited: false } } }
    expect(copilotLimits(undated, '2026-12-31T23:00:00.000Z')?.month?.resetsAt).toBe('2027-01-01T00:00:00.000Z')
  })
})

describe('billingLimits', () => {
  it('counts the Copilot requests of the month without knowing the allowance', () => {
    expect(billingLimits(BILLING, AT)).toEqual({
      fiveHour: null,
      sevenDay: null,
      month: { usedPercentage: 0, resetsAt: NEXT_MONTH, used: 52.5 },
      updatedAt: AT,
      source: 'api',
    })
  })

  it('has nothing to read without usage items', () => {
    expect(billingLimits({ user: 'octocat' }, AT)).toBeUndefined()
  })
})

describe('askCopilot', () => {
  it('asks GitHub with the sign-in token', async () => {
    const fetchImpl = routes({ [COPILOT_USER_URL]: { status: 200, body: PRO } })
    expect(await askCopilot('gho_x', AT, 1000, fetchImpl)).toMatchObject({ kind: 'limits', limits: { month: { left: 120 } } })
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.headers).toMatchObject({ Authorization: 'token gho_x' })
  })

  it('says a refused sign-in and an unlimited plan', async () => {
    expect(await askCopilot('gho_x', AT, 1000, routes({ [COPILOT_USER_URL]: { status: 401, body: {} } }))).toEqual({
      kind: 'missing',
      reason: notice('usage.copilotSignIn', {}),
    })
    const unlimited = { quota_snapshots: { premium_interactions: { unlimited: true } } }
    expect(await askCopilot('gho_x', AT, 1000, routes({ [COPILOT_USER_URL]: { status: 200, body: unlimited } }))).toEqual({
      kind: 'missing',
      reason: notice('usage.copilotUnlimited', {}),
    })
  })
})

describe('askCopilotToken', () => {
  const USER = 'https://api.github.com/user'
  const USAGE = 'https://api.github.com/users/octocat/settings/billing/premium_request/usage'

  it('takes the allowance when GitHub gives it to the token', async () => {
    const fetchImpl = routes({ [COPILOT_USER_URL]: { status: 200, body: PRO } })
    expect(await askCopilotToken('github_pat_x', AT, 1000, fetchImpl)).toMatchObject({ kind: 'limits', limits: { month: { left: 120 } } })
  })

  it('falls back to the billing usage of the token’s user', async () => {
    const fetchImpl = routes({ [USER]: { status: 200, body: { login: 'octocat' } }, [USAGE]: { status: 200, body: BILLING } })
    expect(await askCopilotToken('github_pat_x', AT, 1000, fetchImpl)).toMatchObject({ kind: 'limits', limits: { month: { used: 52.5 } } })
  })

  it('names the permission the token lacks', async () => {
    const fetchImpl = routes({ [USER]: { status: 200, body: { login: 'octocat' } }, [USAGE]: { status: 403, body: { message: 'Resource not accessible' } } })
    expect(await askCopilotToken('github_pat_x', AT, 1000, fetchImpl)).toEqual({ kind: 'missing', reason: notice('usage.planRead', {}) })
  })

  it('says a refused token', async () => {
    const fetchImpl = routes({ [USER]: { status: 401, body: {} } })
    expect(await askCopilotToken('github_pat_x', AT, 1000, fetchImpl)).toEqual({ kind: 'missing', reason: notice('usage.copilotSignIn', {}) })
  })
})
