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
  it("asks OpenAI's models list, then /v1/me for the organization, with the key as a bearer token", async () => {
    const seen: { url: string; headers: Headers }[] = []
    const fetchImpl: typeof fetch = async (url, init) => {
      seen.push({ url: String(url), headers: new Headers(init?.headers) })
      return new Response('{}', { status: 200 })
    }
    expect(await checkOpenAiKey('sk-proj-fake-0000000000000000', 1000, fetchImpl)).toEqual({ state: 'ok' })
    expect(seen.map((request) => request.url)).toEqual(['https://api.openai.com/v1/models', 'https://api.openai.com/v1/me'])
    for (const request of seen) expect(request.headers.get('authorization')).toBe('Bearer sk-proj-fake-0000000000000000')
  })

  it('asks nothing more of a key the models list refuses or cannot judge', async () => {
    const urls: string[] = []
    const refusing: typeof fetch = async (url) => {
      urls.push(String(url))
      return new Response('{}', { status: 401 })
    }
    expect(await checkOpenAiKey('sk-proj-fake-0000000000000000', 1000, refusing)).toEqual({ state: 'rejected' })
    expect(urls).toEqual(['https://api.openai.com/v1/models'])
  })

  it('takes 401 and 403 for a refused key and anything else for no verdict', async () => {
    expect(await checkOpenAiKey('sk-proj-fake-0000000000000000', 1000, answer(401))).toEqual({ state: 'rejected' })
    expect(await checkOpenAiKey('sk-proj-fake-0000000000000000', 1000, answer(403))).toEqual({ state: 'rejected' })
    expect(await checkOpenAiKey('sk-proj-fake-0000000000000000', 1000, answer(503))).toEqual({ state: 'unknown', reason: 'HTTP 503' })
  })
})

describe('the organization a working key pays through (BTN-418)', () => {
  const answering = (status: number, headers: Record<string, string>): typeof fetch => async () => new Response('{}', { status, headers })

  it("takes Anthropic's from anthropic-organization-id", async () => {
    const fetchImpl = answering(200, { 'anthropic-organization-id': 'org-anthropic-example' })
    expect(await checkApiKey('sk-ant-fake-0000000000000000', 1000, fetchImpl)).toEqual({ state: 'ok', organization: 'org-anthropic-example' })
  })

  it("takes OpenAI's from openai-organization", async () => {
    const fetchImpl = answering(200, { 'openai-organization': 'org-openai-example', 'openai-project': 'proj_example' })
    expect(await checkOpenAiKey('sk-proj-fake-0000000000000000', 1000, fetchImpl)).toEqual({ state: 'ok', organization: 'org-openai-example' })
  })

  // Seen live on 2026-10-31 (BTN-649): the models list carries no openai-organization, /v1/me does.
  const openAi = (me: () => Promise<Response>): typeof fetch => async (url) =>
    String(url).endsWith('/v1/me') ? me() : new Response('{}', { status: 200 })

  it("takes OpenAI's from /v1/me when the models list has none", async () => {
    const fetchImpl = openAi(async () => new Response('{}', { status: 200, headers: { 'openai-organization': 'user-example' } }))
    expect(await checkOpenAiKey('sk-proj-fake-0000000000000000', 1000, fetchImpl)).toEqual({ state: 'ok', organization: 'user-example' })
  })

  it('keeps a working OpenAI key working when /v1/me refuses, fails or is out of reach', async () => {
    const forbidden = openAi(async () => new Response('{}', { status: 403, headers: { 'openai-organization': 'org-x' } }))
    expect(await checkOpenAiKey('sk-proj-fake-0000000000000000', 1000, forbidden)).toEqual({ state: 'ok' })
    const broken = openAi(async () => new Response('{}', { status: 500 }))
    expect(await checkOpenAiKey('sk-proj-fake-0000000000000000', 1000, broken)).toEqual({ state: 'ok' })
    const down = openAi(async () => {
      throw new Error('fetch failed')
    })
    expect(await checkOpenAiKey('sk-proj-fake-0000000000000000', 1000, down)).toEqual({ state: 'ok' })
  })

  it('knows none from an answer without the header, an empty one, or a refusal', async () => {
    expect(await checkApiKey('sk-ant-fake-0000000000000000', 1000, answering(200, {}))).toEqual({ state: 'ok' })
    expect(await checkOpenAiKey('sk-proj-fake-0000000000000000', 1000, answering(200, { 'openai-organization': ' ' }))).toEqual({ state: 'ok' })
    expect(await checkApiKey('sk-ant-fake-0000000000000000', 1000, answering(401, { 'anthropic-organization-id': 'org-x' }))).toEqual({ state: 'rejected' })
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
