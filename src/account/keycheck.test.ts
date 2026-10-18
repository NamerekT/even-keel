import { describe, expect, it } from 'vitest'
import { checkApiKey, checkOpenAiKey, KeyChecks } from './keycheck.js'

const answer = (status: number): typeof fetch => async () => new Response('{}', { status })

describe('checkApiKey', () => {
  it('asks the models list with the key and the API version', async () => {
    let seen: { url: string; headers: Headers } | undefined
    const fetchImpl: typeof fetch = async (url, init) => {
      seen = { url: String(url), headers: new Headers(init?.headers) }
      return new Response('{}', { status: 200 })
    }
    expect(await checkApiKey('sk-ant-fake-0000000000000000', 1000, fetchImpl)).toEqual({ state: 'ok' })
    expect(seen?.url).toBe('https://api.anthropic.com/v1/models?limit=1')
    expect(seen?.headers.get('x-api-key')).toBe('sk-ant-fake-0000000000000000')
    expect(seen?.headers.get('anthropic-version')).toBe('2023-06-01')
  })

  it('takes 401 and 403 for a key Anthropic refuses', async () => {
    expect(await checkApiKey('sk-ant-fake-0000000000000000', 1000, answer(401))).toEqual({ state: 'rejected' })
    expect(await checkApiKey('sk-ant-fake-0000000000000000', 1000, answer(403))).toEqual({ state: 'rejected' })
  })

  it('knows nothing when Anthropic is busy, broken or out of reach', async () => {
    expect(await checkApiKey('sk-ant-fake-0000000000000000', 1000, answer(429))).toEqual({ state: 'unknown', reason: 'HTTP 429' })
    expect(await checkApiKey('sk-ant-fake-0000000000000000', 1000, answer(529))).toEqual({ state: 'unknown', reason: 'HTTP 529' })
    const down: typeof fetch = async () => {
      throw new TypeError('fetch failed')
    }
    expect(await checkApiKey('sk-ant-fake-0000000000000000', 1000, down)).toEqual({ state: 'unknown', reason: 'fetch failed' })
  })
})

describe('checkOpenAiKey', () => {
  it("asks OpenAI's models list with the key as a bearer token", async () => {
    let seen: { url: string; headers: Headers } | undefined
    const fetchImpl: typeof fetch = async (url, init) => {
      seen = { url: String(url), headers: new Headers(init?.headers) }
      return new Response('{}', { status: 200 })
    }
    expect(await checkOpenAiKey('sk-proj-fake-0000000000000000', 1000, fetchImpl)).toEqual({ state: 'ok' })
    expect(seen?.url).toBe('https://api.openai.com/v1/models')
    expect(seen?.headers.get('authorization')).toBe('Bearer sk-proj-fake-0000000000000000')
  })

  it('takes 401 and 403 for a refused key and anything else for no verdict', async () => {
    expect(await checkOpenAiKey('sk-proj-fake-0000000000000000', 1000, answer(401))).toEqual({ state: 'rejected' })
    expect(await checkOpenAiKey('sk-proj-fake-0000000000000000', 1000, answer(403))).toEqual({ state: 'rejected' })
    expect(await checkOpenAiKey('sk-proj-fake-0000000000000000', 1000, answer(503))).toEqual({ state: 'unknown', reason: 'HTTP 503' })
  })
})

describe('KeyChecks', () => {
  const hour = 60 * 60_000
  const at = (minutes: number) => new Date(Date.UTC(2026, 9, 17, 12, minutes))

  it('is due for a key it has not checked and again an interval after the last check', () => {
    const checks = new KeyChecks(hour)
    expect(checks.due('work', at(0))).toBe(true)
    checks.note('work', { state: 'ok' }, at(0))
    expect(checks.due('work', at(59))).toBe(false)
    expect(checks.due('work', at(60))).toBe(true)
  })

  it('keeps the last clear verdict when a check knows nothing', () => {
    const checks = new KeyChecks(hour)
    checks.note('work', { state: 'rejected' }, at(0))
    checks.note('work', { state: 'unknown', reason: 'HTTP 529' }, at(60))
    expect(checks.rejected('work')).toBe(true)
    expect(checks.due('work', at(61))).toBe(false)
    checks.note('work', { state: 'ok' }, at(120))
    expect(checks.rejected('work')).toBe(false)
  })

  it('forgets a removed account', () => {
    const checks = new KeyChecks(hour)
    checks.note('work', { state: 'rejected' }, at(0))
    checks.forget('work')
    expect(checks.rejected('work')).toBe(false)
    expect(checks.due('work', at(1))).toBe(true)
  })
})
