import { describe, expect, it, vi } from 'vitest'
import { chatGptModels, filterChatGptModels } from './models.js'

const AT = Date.parse('2026-10-29T12:00:00Z')
const auth = (extra = {}) => JSON.stringify({ openai: { type: 'oauth', access: 'fake-access', accountId: 'fake-account', expires: AT + 60_000, ...extra } })
const listed = ['openai/allowed', 'openai/denied', 'opencode/free', 'anthropic/other']
const body = { models: [{ slug: 'allowed', visibility: 'list' }, { slug: 'hidden', visibility: 'hide' }] }

describe('OpenCode ChatGPT models', () => {
  it('reads only visible slugs and distinguishes an empty list from an unreadable answer', () => {
    expect(chatGptModels(body)).toEqual(['allowed'])
    expect(chatGptModels({ models: [] })).toEqual([])
    for (const value of [null, {}, { models: {} }, { models: [{}] }, { models: [{ slug: 'x' }] }, { models: [{ slug: 1, visibility: 'list' }] }]) {
      expect(chatGptModels(value)).toBeUndefined()
    }
  })

  it('intersects OpenAI only, without adding models absent from OpenCode', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ models: [...body.models, { slug: 'absent', visibility: 'list' }] }))
    const log = vi.fn()
    expect(await filterChatGptModels(listed, auth(), 1000, log, fetchImpl, AT)).toEqual(['openai/allowed', 'opencode/free', 'anthropic/other'])
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(new URL(url).searchParams.get('client_version')).toMatch(/^\d+\.\d+\.\d+$/)
    expect(init.headers).toMatchObject({ Authorization: 'Bearer fake-access', 'ChatGPT-Account-Id': 'fake-account' })
    expect(log).not.toHaveBeenCalled()
  })

  it('keeps a valid empty intersection', async () => {
    expect(await filterChatGptModels(['openai/denied'], auth(), 1000, vi.fn(), async () => Response.json({ models: [] }), AT)).toEqual([])
  })

  it('leaves API keys and other providers alone without a request', async () => {
    const fetchImpl = vi.fn()
    for (const value of [undefined, '{}', auth({ type: 'api' })]) expect(await filterChatGptModels(listed, value, 1000, vi.fn(), fetchImpl, AT)).toEqual(listed)
    expect(await filterChatGptModels(['opencode/free'], auth(), 1000, vi.fn(), fetchImpl, AT)).toEqual(['opencode/free'])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does not refresh an expired or missing access token', async () => {
    const fetchImpl = vi.fn()
    for (const extra of [{ expires: AT }, { access: '' }]) {
      const log = vi.fn()
      expect(await filterChatGptModels(listed, auth(extra), 1000, log, fetchImpl, AT)).toEqual(listed)
      expect(log).toHaveBeenCalledTimes(1)
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([401, 403, 429, 500])('keeps the catalogue after HTTP %s and logs once', async status => {
    const log = vi.fn()
    expect(await filterChatGptModels(listed, auth(), 1000, log, async () => new Response('{}', { status }), AT)).toEqual(listed)
    expect(log).toHaveBeenCalledTimes(1)
  })

  it.each(['invalid JSON', '{}', '{"models":[{}]}'])('keeps the catalogue after an unreadable answer: %s', async value => {
    const log = vi.fn()
    expect(await filterChatGptModels(listed, auth(), 1000, log, async () => new Response(value), AT)).toEqual(listed)
    expect(log).toHaveBeenCalledTimes(1)
  })

  it('does not include fetch errors or credentials in the log', async () => {
    const log = vi.fn()
    expect(await filterChatGptModels(listed, auth(), 1000, log, async () => { throw new Error('fake-access') }, AT)).toEqual(listed)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]![0]).not.toContain('fake-access')
  })
})
