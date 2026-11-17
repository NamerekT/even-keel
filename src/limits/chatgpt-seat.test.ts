import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { askChatGpt, chatGptLimits, CHATGPT_USAGE_URL } from './chatgpt.js'
import { chatGptSeatUsageUrl } from './chatgpt-seat.js'
import { exhaustedReset, limitReopenedAt, newestLimits, type RateLimits } from './model.js'
import { overageLimit } from './overage.js'
import { notice } from '../notice/notice.js'

const AT = '2030-01-14T10:00:00.000Z'
const NEXT_MONTH = '2030-02-01T00:00:00.000Z'
const read = (name: string): Record<string, unknown> => JSON.parse(readFileSync(`test/fixtures/limits/${name}`, 'utf8'))
const EDU = read('chatgpt-edu-wham-usage.json')
const MONTHLY = read('chatgpt-edu-monthly-usage.json')
const capped = (body: Record<string, unknown>) => ({ ...body, spend_control: { reached: true, individual_limit: null } })
const SIGN_IN = { token: 'tok', accountId: 'acc-1', expiresAt: null }

function answers(...replies: Array<[number, unknown] | Error>) {
  const queue = [...replies]
  return vi.fn(async () => {
    const next = queue.shift()
    if (next === undefined) throw new Error('no more answers')
    if (next instanceof Error) throw next
    return new Response(JSON.stringify(next[1]), { status: next[0] })
  })
}

describe('a ChatGPT workspace seat', () => {
  it('shows its monthly credits as the month, used of the cap, resetting at the next calendar month in UTC', () => {
    const limits = chatGptLimits(EDU, AT, MONTHLY)
    expect(limits).toMatchObject({
      fiveHour: { usedPercentage: 8, resetsAt: '2030-01-14T13:00:00.000Z' },
      sevenDay: { usedPercentage: 23, resetsAt: '2030-01-18T08:00:00.000Z' },
      month: { usedPercentage: 25, resetsAt: NEXT_MONTH, used: 1250, limit: 5000 },
      spendCap: { reached: false, updatedAt: AT },
      open: true,
    })
    expect(exhaustedReset(limits ?? null)).toBeNull()
  })

  it('has no month when the monthly usage was not read, and none from a personal plan', () => {
    expect(chatGptLimits(EDU, AT)).not.toHaveProperty('month')
    const pro = read('chatgpt-pro-wham-usage.json')
    const limits = chatGptLimits(pro, AT, MONTHLY)
    expect(limits).not.toHaveProperty('month')
    expect(limits).not.toHaveProperty('spendCap')
  })

  it('closes the account on a reached cap, the month spent to its end, and says so', () => {
    const limits = chatGptLimits(capped(EDU), AT, MONTHLY)
    expect(limits).toMatchObject({ open: false, spendCap: { reached: true }, month: { usedPercentage: 100, resetsAt: NEXT_MONTH, used: 1250, limit: 5000 } })
    expect(exhaustedReset(limits ?? null)).toBe(NEXT_MONTH)
  })

  it('closes it on a reached cap even without the monthly usage, on a personal plan too', () => {
    expect(exhaustedReset(chatGptLimits(capped(EDU), AT) ?? null)).toBe(NEXT_MONTH)
    const pro = capped(read('chatgpt-pro-wham-usage.json'))
    expect(chatGptLimits(pro, AT)).toMatchObject({ open: false, spendCap: { reached: true }, month: { usedPercentage: 100, resetsAt: NEXT_MONTH } })
  })

  it('leaves the closing to the cap flag: the count alone does not spend the month', () => {
    const over = { ...MONTHLY, current_month_usage: 5200 }
    const limits = chatGptLimits(EDU, AT, over)
    expect(limits?.month?.usedPercentage).toBeLessThan(100)
    expect(limits?.month).toMatchObject({ used: 5200, limit: 5000 })
    expect(exhaustedReset(limits ?? null)).toBeNull()
  })

  it('shows what was spent alone when the seat has no cap, and nothing from an unreadable answer', () => {
    expect(chatGptLimits(EDU, AT, { ...MONTHLY, effective_monthly_limit: null })?.month).toEqual({ usedPercentage: 0, resetsAt: NEXT_MONTH, used: 1250 })
    for (const odd of [{}, 'x', { ...MONTHLY, current_month_usage: '1250' }, { ...MONTHLY, balance_unit: 'usd' }]) {
      expect(chatGptLimits(EDU, AT, odd)).not.toHaveProperty('month')
    }
  })

  it('rolls December over into January of the next year', () => {
    expect(chatGptLimits(EDU, '2030-12-31T23:59:00.000Z', MONTHLY)?.month?.resetsAt).toBe('2031-01-01T00:00:00.000Z')
  })

  it('reopens a held session once a poll says the cap is no longer reached', () => {
    const refusedAt = '2030-01-14T09:00:00.000Z'
    expect(limitReopenedAt(chatGptLimits(capped(EDU), AT, MONTHLY) ?? null, refusedAt, NEXT_MONTH)).toBeNull()
    expect(limitReopenedAt(chatGptLimits(EDU, AT, MONTHLY) ?? null, refusedAt, NEXT_MONTH)).toBe(AT)
  })

  it('is no paid-usage evidence: the seat’s credits are the cap itself', () => {
    const limits = chatGptLimits(capped(EDU), AT, MONTHLY) ?? null
    expect(overageLimit({ agent: 'codex', needsLogin: false, apiKey: false, working: true, limits }, new Date(AT))).toBeNull()
  })

  it('keeps the cap and its month through a newer session snapshot of the windows', () => {
    const polled = chatGptLimits(capped(EDU), AT, MONTHLY)
    const streamed: RateLimits = { fiveHour: { usedPercentage: 9, resetsAt: '2030-01-14T13:00:00.000Z' }, sevenDay: null, updatedAt: '2030-01-14T10:01:00.000Z', source: 'statusline' }
    const newest = newestLimits(polled, streamed)
    expect(newest).toMatchObject({ fiveHour: { usedPercentage: 9 }, spendCap: { reached: true }, month: { usedPercentage: 100 } })
    expect(exhaustedReset(newest ?? null)).toBe(NEXT_MONTH)
  })
})

describe('askChatGpt on a workspace seat', () => {
  it('asks the monthly usage with the same token and account, in the same poll', async () => {
    const fetchImpl = answers([200, EDU], [200, MONTHLY])
    const answer = await askChatGpt(SIGN_IN, AT, 1000, fetchImpl)
    expect(answer).toMatchObject({ kind: 'limits', limits: { pool: 'chatgpt:acc-1', month: { used: 1250, limit: 5000 } } })
    expect(answer).not.toHaveProperty('reason')
    const calls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>
    expect(calls.map(([url]) => url)).toEqual([CHATGPT_USAGE_URL, chatGptSeatUsageUrl('acc-1')])
    expect(chatGptSeatUsageUrl('acc-1')).toBe('https://chatgpt.com/backend-api/accounts/acc-1/spend-controls/current-user/monthly-usage?supports_usage_limit_modes=true')
    expect(calls[1]?.[1].headers).toMatchObject({ Authorization: 'Bearer tok', 'ChatGPT-Account-Id': 'acc-1' })
  })

  it.each([403, 404, 500])('reads the windows without the month when the monthly usage answers %s', async (status) => {
    const answer = await askChatGpt(SIGN_IN, AT, 1000, answers([200, EDU], [status, {}]))
    expect(answer).toMatchObject({ kind: 'limits', limits: { fiveHour: { usedPercentage: 8 } } })
    if (answer.kind === 'limits') expect(answer.limits).not.toHaveProperty('month')
  })

  it('reads the windows without the month when the monthly usage fails on the network', async () => {
    const answer = await askChatGpt(SIGN_IN, AT, 1000, answers([200, EDU], new Error('socket hang up')))
    expect(answer).toMatchObject({ kind: 'limits', limits: { fiveHour: { usedPercentage: 8 } } })
  })

  it('names the reached cap as the reason', async () => {
    const answer = await askChatGpt(SIGN_IN, AT, 1000, answers([200, capped(EDU)], [403, {}]))
    expect(answer).toMatchObject({ kind: 'limits', limits: { open: false }, reason: notice('usage.chatGptSpendCap', {}) })
  })

  it('does not ask the monthly usage of a personal plan or without an account', async () => {
    const pro = answers([200, read('chatgpt-pro-wham-usage.json')])
    await askChatGpt(SIGN_IN, AT, 1000, pro)
    expect(pro).toHaveBeenCalledTimes(1)
    const anonymous = answers([200, EDU])
    await askChatGpt({ ...SIGN_IN, accountId: null }, AT, 1000, anonymous)
    expect(anonymous).toHaveBeenCalledTimes(1)
  })
})
