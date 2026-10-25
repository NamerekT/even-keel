import { describe, expect, it } from 'vitest'
import { checkCredit, checkOpenAiCredit, CreditChecks } from './credit.js'

const KEY = 'sk-ant-fake-0000000000000000'
const MODELS = { data: [{ id: 'claude-opus-fake' }, { id: 'claude-haiku-fake' }, { id: 'claude-sonnet-fake' }] }
const EMPTY = {
  type: 'error',
  error: {
    type: 'invalid_request_error',
    message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
  },
}

interface Seen {
  url: string
  method: string
  headers: Headers
  body: unknown
}

function api(message: { status: number; body: unknown }, models: { status: number; body: unknown } = { status: 200, body: MODELS }) {
  const seen: Seen[] = []
  const fetchImpl: typeof fetch = async (url, init) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    seen.push({ url: String(url), method: init?.method ?? 'GET', headers: new Headers(init?.headers), body })
    const answer = String(url).includes('/v1/models') ? models : message
    return new Response(JSON.stringify(answer.body), { status: answer.status })
  }
  return { seen, fetchImpl }
}

describe('checkCredit', () => {
  it('sends one output token to the cheapest model the key lists', async () => {
    const { seen, fetchImpl } = api({ status: 200, body: { type: 'message' } })
    expect(await checkCredit(KEY, 1000, fetchImpl)).toEqual({ state: 'ok' })
    expect(seen).toHaveLength(2)
    expect(seen[1]).toMatchObject({ url: 'https://api.anthropic.com/v1/messages', method: 'POST' })
    expect(seen[1]!.body).toMatchObject({ model: 'claude-haiku-fake', max_tokens: 1 })
    expect(seen[1]!.headers.get('x-api-key')).toBe(KEY)
    expect(seen[1]!.headers.get('anthropic-version')).toBe('2023-06-01')
  })

  it('takes the newest model when the key lists no Haiku', async () => {
    const { seen, fetchImpl } = api({ status: 200, body: {} }, { status: 200, body: { data: [{ id: 'claude-sonnet-fake' }] } })
    await checkCredit(KEY, 1000, fetchImpl)
    expect(seen[1]!.body).toMatchObject({ model: 'claude-sonnet-fake' })
  })

  it('says the key is still out of credit on the billing answer', async () => {
    expect(await checkCredit(KEY, 1000, api({ status: 400, body: EMPTY }).fetchImpl)).toEqual({ state: 'empty' })
  })

  it.each(['API', 'workspace API'])('keeps waiting on the specified %s spending limit', async (scope) => {
    const body = { error: { message: `You have reached your specified ${scope} usage limits. You will regain access on 2026-11-01 at 00:00 UTC.` } }
    expect(await checkCredit(KEY, 1000, api({ status: 400, body }).fetchImpl)).toEqual({ state: 'empty' })
  })

  it('knows nothing from any other answer', async () => {
    expect(await checkCredit(KEY, 1000, api({ status: 529, body: {} }).fetchImpl)).toEqual({ state: 'unknown', reason: 'HTTP 529' })
    const badRequest = { type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens: invalid' } }
    expect(await checkCredit(KEY, 1000, api({ status: 400, body: badRequest }).fetchImpl)).toEqual({ state: 'unknown', reason: 'HTTP 400' })
    expect(await checkCredit(KEY, 1000, api({ status: 200, body: {} }, { status: 401, body: {} }).fetchImpl)).toEqual({
      state: 'unknown',
      reason: 'models HTTP 401',
    })
    expect(await checkCredit(KEY, 1000, api({ status: 200, body: {} }, { status: 200, body: { data: [] } }).fetchImpl)).toEqual({
      state: 'unknown',
      reason: 'the key lists no models',
    })
    const down: typeof fetch = async () => {
      throw new TypeError('fetch failed')
    }
    expect(await checkCredit(KEY, 1000, down)).toEqual({ state: 'unknown', reason: 'fetch failed' })
  })
})

describe('checkOpenAiCredit', () => {
  const OPENAI_KEY = 'sk-proj-fake-0000000000000000'
  const OPENAI_MODELS = {
    data: [{ id: 'gpt-fake' }, { id: 'gpt-fake-mini-tts' }, { id: 'gpt-fake-mini' }, { id: 'gpt-fake-nano-transcribe' }, { id: 'gpt-fake-nano' }],
  }
  const QUOTA = {
    error: {
      message: 'You exceeded your current quota, please check your plan and billing details.',
      type: 'insufficient_quota',
      code: 'insufficient_quota',
    },
  }
  const openAi = (message: { status: number; body: unknown }, models = { status: 200, body: OPENAI_MODELS }) => api(message, models)

  it('asks the cheapest text model the key lists for a few output tokens', async () => {
    const { seen, fetchImpl } = openAi({ status: 200, body: { object: 'response' } })
    expect(await checkOpenAiCredit(OPENAI_KEY, 1000, fetchImpl)).toEqual({ state: 'ok' })
    expect(seen[0]!.url).toBe('https://api.openai.com/v1/models')
    expect(seen[1]).toMatchObject({ url: 'https://api.openai.com/v1/responses', method: 'POST' })
    expect(seen[1]!.body).toMatchObject({ model: 'gpt-fake-nano', max_output_tokens: 16 })
    expect(seen[1]!.headers.get('authorization')).toBe(`Bearer ${OPENAI_KEY}`)
  })

  it('takes a mini model when the key lists no nano', async () => {
    const { seen, fetchImpl } = openAi({ status: 200, body: {} }, { status: 200, body: { data: [{ id: 'gpt-fake' }, { id: 'gpt-fake-mini' }] } })
    await checkOpenAiCredit(OPENAI_KEY, 1000, fetchImpl)
    expect(seen[1]!.body).toMatchObject({ model: 'gpt-fake-mini' })
  })

  it('says the key is still out of money on insufficient_quota', async () => {
    expect(await checkOpenAiCredit(OPENAI_KEY, 1000, openAi({ status: 429, body: QUOTA }).fetchImpl)).toEqual({ state: 'empty' })
  })

  it('knows nothing from a rate limit or a key with no text model', async () => {
    const rate = { error: { message: 'Rate limit reached', type: 'requests', code: 'rate_limit_exceeded' } }
    expect(await checkOpenAiCredit(OPENAI_KEY, 1000, openAi({ status: 429, body: rate }).fetchImpl)).toEqual({ state: 'unknown', reason: 'HTTP 429' })
    const none = { status: 200, body: { data: [{ id: 'whisper-fake' }, { id: 'gpt-fake-mini-tts' }] } }
    expect(await checkOpenAiCredit(OPENAI_KEY, 1000, openAi({ status: 200, body: {} }, none).fetchImpl)).toEqual({
      state: 'unknown',
      reason: 'the key lists no models',
    })
  })
})

describe('CreditChecks', () => {
  const minutes = (count: number) => count * 60_000
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 17, 12, minute))
  const iso = (minute: number) => at(minute).toISOString()

  it('shows a spending cap until recovery and replaces it on a later refusal', () => {
    const checks = new CreditChecks(minutes(5))
    const text = 'You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.'
    checks.restoredAfter('work', iso(0), at(0), text)
    expect(checks.spendingLimit('work', at(5))).toEqual({ resetsAt: '2026-11-01T00:00:00.000Z' })
    checks.note('work', { state: 'unknown', reason: 'HTTP 529' }, at(5))
    expect(checks.restoredAfter('work', iso(0), at(6), text)).toBeNull()
    expect(checks.spendingLimit('work', at(17))).toBeNull()
    checks.restoredAfter('work', iso(0), at(17), text)
    checks.note('work', { state: 'ok' }, at(18))
    expect(checks.spendingLimit('work', at(18))).toBeNull()
    checks.restoredAfter('work', iso(20), at(20), 'You have reached your specified workspace API usage limits.')
    expect(checks.spendingLimit('work', at(20))).toEqual({ resetsAt: null })
    checks.restoredAfter('work', iso(30), at(30), 'Credit balance is too low')
    expect(checks.spendingLimit('work', at(30))).toBeNull()
  })

  it('starts checking an interval after it was first asked, and only for asked keys', () => {
    const checks = new CreditChecks(minutes(5))
    expect(checks.restoredAfter('work', iso(0), at(0))).toBeNull()
    expect(checks.due(at(4))).toEqual([])
    expect(checks.due(at(5))).toEqual(['work'])
  })

  it('checks again an interval after a check that found no credit', () => {
    const checks = new CreditChecks(minutes(5))
    checks.restoredAfter('work', iso(0), at(0))
    checks.note('work', { state: 'empty' }, at(5))
    checks.restoredAfter('work', iso(0), at(6))
    expect(checks.due(at(9))).toEqual([])
    expect(checks.due(at(10))).toEqual(['work'])
  })

  it('gives the moment the credit came back and stops checking', () => {
    const checks = new CreditChecks(minutes(5))
    checks.restoredAfter('work', iso(0), at(0))
    checks.note('work', { state: 'ok' }, at(5))
    expect(checks.restoredAfter('work', iso(0), at(6))).toBe(iso(5))
    expect(checks.due(at(20))).toEqual([])
  })

  it('starts over for a newer stop on the same key', () => {
    const checks = new CreditChecks(minutes(5))
    checks.restoredAfter('work', iso(0), at(0))
    checks.note('work', { state: 'ok' }, at(5))
    expect(checks.restoredAfter('work', iso(30), at(30))).toBeNull()
    expect(checks.due(at(35))).toEqual(['work'])
  })

  it('stops checking a key nobody has asked about for a while', () => {
    const checks = new CreditChecks(minutes(5))
    checks.restoredAfter('work', iso(0), at(0))
    expect(checks.due(at(10))).toEqual(['work'])
    expect(checks.due(at(11))).toEqual([])
  })

  it('forgets a removed account', () => {
    const checks = new CreditChecks(minutes(5))
    checks.restoredAfter('work', iso(0), at(0))
    checks.forget('work')
    expect(checks.due(at(5))).toEqual([])
  })
})
