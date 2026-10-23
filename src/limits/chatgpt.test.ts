import { describe, expect, it, vi } from 'vitest'
import { askChatGpt, chatGptAccountIn, chatGptAccountOf, chatGptLimits, CHATGPT_USAGE_URL } from './chatgpt.js'
import { notice } from '../notice/notice.js'

const AT = '2026-10-23T10:00:00.000Z'
const RESET_5H = Date.parse('2026-10-23T12:30:00.000Z') / 1000
const RESET_WEEK = Date.parse('2026-10-28T08:00:00.000Z') / 1000

const window = (used: number, minutes: number, resetAt: number) => ({
  used_percent: used,
  limit_window_seconds: minutes * 60,
  reset_after_seconds: 0,
  reset_at: resetAt,
})

const PLUS = {
  plan_type: 'plus',
  rate_limit: { allowed: true, limit_reached: false, primary_window: window(42, 300, RESET_5H), secondary_window: window(17, 10080, RESET_WEEK) },
  credits: null,
}

function jwt(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${part({ alg: 'none' })}.${part(claims)}.sig`
}

function answering(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }))
}

describe('chatGptLimits', () => {
  it('reads the five-hour and the weekly window by their length', () => {
    expect(chatGptLimits(PLUS, AT)).toEqual({
      fiveHour: { usedPercentage: 42, resetsAt: '2026-10-23T12:30:00.000Z' },
      sevenDay: { usedPercentage: 17, resetsAt: '2026-10-28T08:00:00.000Z' },
      updatedAt: AT,
      source: 'api',
    })
  })

  it('reads the free plan’s 30 days as the month and takes the reset from the seconds left when there is no time', () => {
    const free = { plan_type: 'free', rate_limit: { primary_window: { used_percent: 5, limit_window_seconds: 43200 * 60, reset_after_seconds: 3600 } } }
    expect(chatGptLimits(free, AT)).toEqual({
      fiveHour: null,
      sevenDay: null,
      month: { usedPercentage: 5, resetsAt: '2026-10-23T11:00:00.000Z' },
      updatedAt: AT,
      source: 'api',
    })
  })

  it('has nothing to read without a rate limit', () => {
    expect(chatGptLimits({ plan_type: 'plus', rate_limit: null }, AT)).toBeUndefined()
    expect(chatGptLimits('nope', AT)).toBeUndefined()
  })
})

describe('chatGptAccountOf', () => {
  it('takes the account id out of the access token', () => {
    expect(chatGptAccountOf(jwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acc-1' } }))).toBe('acc-1')
    expect(chatGptAccountOf('not-a-jwt')).toBeNull()
  })
})

describe('chatGptAccountIn', () => {
  it("reads the account of a Codex folder's sign-in, from its token when the id is not written", () => {
    expect(chatGptAccountIn(JSON.stringify({ tokens: { account_id: 'acc-2', access_token: 'x' } }))).toBe('acc-2')
    const access = jwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acc-3' } })
    expect(chatGptAccountIn(JSON.stringify({ tokens: { access_token: access } }))).toBe('acc-3')
  })

  it('has none for an API key or no file', () => {
    expect(chatGptAccountIn(JSON.stringify({ OPENAI_API_KEY: 'sk-x', tokens: null }))).toBeNull()
    expect(chatGptAccountIn(undefined)).toBeNull()
  })
})

describe('askChatGpt', () => {
  it('asks with the token and the account, and names the pool by the account', async () => {
    const fetchImpl = answering(200, PLUS)
    const answer = await askChatGpt({ token: 'tok', accountId: 'acc-1', expiresAt: null }, AT, 1000, fetchImpl)
    expect(answer).toMatchObject({ kind: 'limits', limits: { pool: 'chatgpt:acc-1', source: 'api' } })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(CHATGPT_USAGE_URL)
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok', 'ChatGPT-Account-Id': 'acc-1' })
  })

  it('does not ask with an expired token', async () => {
    const fetchImpl = answering(200, PLUS)
    const answer = await askChatGpt({ token: 'tok', accountId: 'acc-1', expiresAt: Date.parse(AT) - 1 }, AT, 1000, fetchImpl)
    expect(answer).toEqual({ kind: 'missing', reason: notice('usage.chatGptExpired', {}) })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('takes a refused token for an expired one', async () => {
    expect(await askChatGpt({ token: 'tok', accountId: null, expiresAt: null }, AT, 1000, answering(401, {}))).toEqual({
      kind: 'missing',
      reason: notice('usage.chatGptExpired', {}),
    })
  })

  it('throws on any other error, for the watcher to retry', async () => {
    await expect(askChatGpt({ token: 'tok', accountId: null, expiresAt: null }, AT, 1000, answering(502, {}))).rejects.toThrow('502')
  })

  it('says so when the answer has no windows', async () => {
    expect(await askChatGpt({ token: 'tok', accountId: null, expiresAt: null }, AT, 1000, answering(200, { rate_limit: null }))).toEqual({
      kind: 'unknown',
      reason: notice('usage.chatGptUnread', {}),
    })
  })
})
