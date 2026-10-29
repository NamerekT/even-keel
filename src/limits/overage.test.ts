import { describe, expect, it } from 'vitest'
import { chatGptLimits } from './chatgpt.js'
import { billingLimits, copilotLimits } from './copilot.js'
import { currentLimits, limitsOfRateLimitInfo, newestLimits, withSessionLimits } from './model.js'
import { limitsOfRollout } from '../codex/rollout.js'
import { usingOverage } from './overage.js'

const AT = '2026-10-29T10:00:00.000Z'
const window = { usedPercentage: 100, resetsAt: '2026-10-29T12:00:00.000Z' }
const credits = { has_credits: true, unlimited: false, balance: '12.40' }
const body = { credits, rate_limit: { primary_window: { used_percent: 100, limit_window_seconds: 18000, reset_at: Date.parse(window.resetsAt) / 1000 } } }

describe('subscription overage', () => {
  it('reads ChatGPT credit units, including a credit-only answer and a zero or negative balance', () => {
    expect(chatGptLimits(body, AT)?.overage).toEqual({ source: 'chatgpt', updatedAt: AT, unit: 'credits', balance: 12.4, available: true, unlimited: false })
    expect(chatGptLimits({ credits }, AT)?.overage?.balance).toBe(12.4)
    expect(chatGptLimits({ credits: { ...credits, has_credits: false, balance: '0' } }, AT)?.overage?.balance).toBe(0)
    expect(chatGptLimits({ credits: { ...credits, has_credits: false, balance: '-2' } }, AT)?.overage?.balance).toBe(-2)
  })

  it('does not invent credits when absent or malformed', () => {
    expect(chatGptLimits({ ...body, credits: null }, AT)).not.toHaveProperty('overage')
    expect(chatGptLimits({ ...body, credits: { ...credits, balance: 'NaN' } }, AT)?.overage).not.toHaveProperty('balance')
  })

  it('reads the observed zero-credit ChatGPT response and the same credits from a Codex rollout', () => {
    const liveCredits = { has_credits: false, unlimited: false, overage_limit_reached: false, balance: '0', approx_local_messages: [0, 0], approx_cloud_messages: [0, 0] }
    const expected = { source: 'chatgpt', updatedAt: AT, unit: 'credits', balance: 0, available: false, unlimited: false }
    expect(chatGptLimits({ credits: liveCredits }, AT)?.overage).toEqual(expected)
    const line = JSON.stringify({ timestamp: AT, type: 'event_msg', payload: { type: 'token_count', rate_limits: {
      primary: { used_percent: 100, window_minutes: 300, resets_at: Date.parse(window.resetsAt) / 1000 }, secondary: null, credits: liveCredits,
    } } })
    expect(limitsOfRollout(line)?.overage).toEqual(expected)
  })

  it('keeps Claude availability separate from configuration and reads overage-only events', () => {
    const reported = limitsOfRateLimitInfo({ overageStatus: 'rejected', isUsingOverage: false })!
    const limits = withSessionLimits(undefined, reported, AT)
    expect(limits.overage).toEqual({ source: 'claude-sdk', updatedAt: AT, available: false, using: false })
    expect(limits.overage).not.toHaveProperty('enabled')
    expect(withSessionLimits(limits, { fiveHour: window }, AT).overage).toEqual(limits.overage)
    expect(withSessionLimits(limits, limitsOfRateLimitInfo({ isUsingOverage: true })!, AT).overage?.using).toBe(true)
  })

  it('keeps money with its own timestamp when a newer statusline reports only windows', () => {
    const a = chatGptLimits(body, AT)!
    const b = { fiveHour: window, sevenDay: null, source: 'statusline' as const, updatedAt: '2026-10-29T10:01:00.000Z' }
    expect(newestLimits(a, b)).toMatchObject({ ...b, overage: a.overage })
    expect(newestLimits(b, a)).toMatchObject({ ...b, overage: a.overage })
  })

  it('reads actual net Copilot dollars, never gross charges for included requests', () => {
    const usageItems = [{ product: 'Copilot', grossQuantity: 100, grossAmount: 4, netAmount: 0 }, { product: 'Copilot', grossQuantity: 30, netAmount: 1.2 }, { product: 'Actions', netAmount: 99 }]
    expect(billingLimits({ usageItems }, AT)?.overage).toEqual({ source: 'github-billing', unit: 'USD', used: 1.2, updatedAt: AT })
    expect(billingLimits({ usageItems: [{ product: 'Copilot', grossQuantity: 5 }] }, AT)).not.toHaveProperty('overage')
  })

  it('does not carry a previous sign-in’s credit snapshot through newer windows', () => {
    const known = chatGptLimits(body, AT)!
    const merged = { ...known, updatedAt: '2026-10-29T10:02:00.000Z' }
    expect(currentLimits(merged, new Date(merged.updatedAt), '2026-10-29T10:01:00.000Z')).not.toHaveProperty('overage')
  })

  it('reads Copilot overage permission from the allowance being shown, without inventing a budget', () => {
    const limits = copilotLimits({ quota_snapshots: { chat: { entitlement: 200, remaining: 166, overage_permitted: false, overage_count: 0 } } }, AT)
    expect(limits).toMatchObject({ overage: { source: 'github-quota', updatedAt: AT, enabled: false, count: 0 } })
    expect(limits).not.toHaveProperty('overage.balance')
  })

  it('marks only a working subscription with fresh evidence, never an idle or refused account', () => {
    const entry = { agent: 'codex', working: true, needsLogin: false, limits: chatGptLimits(body, AT)! }
    expect(usingOverage(entry, new Date(AT))).toBe(true)
    expect(usingOverage({ ...entry, working: false }, new Date(AT))).toBe(false)
    expect(usingOverage({ ...entry, needsLogin: true }, new Date(AT))).toBe(false)
    expect(usingOverage({ ...entry, limits: { ...entry.limits, overage: { ...entry.limits.overage!, available: false } } }, new Date(AT))).toBe(false)
    expect(usingOverage(entry, new Date('2026-10-29T12:00:00Z'))).toBe(false)
    expect(usingOverage(entry, new Date('2026-10-29T10:11:00Z'))).toBe(false)
    expect(usingOverage({ ...entry, limits: { ...entry.limits, fiveHour: { ...window, usedPercentage: 99 } } }, new Date(AT))).toBe(false)
    const claude = withSessionLimits(undefined, limitsOfRateLimitInfo({ isUsingOverage: true })!, AT)
    expect(usingOverage({ ...entry, agent: 'claude', limits: claude }, new Date(AT))).toBe(true)
    expect(usingOverage({ ...entry, agent: 'copilot' }, new Date(AT))).toBe(false)
  })
})
