import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { goLimits, goUsage, checkGoKey, GO_USAGE_URL } from './go.js'
import { openCodeLimitsHidden, openCodeUsage } from './usage.js'
import { exhaustedReset } from '../limits/model.js'

const AT = '2030-01-01T00:00:00.000Z'
const KEY = 'sk-fake-go-example-000000000000'
const auth = (provider = 'opencode-go') => JSON.stringify({ [provider]: { type: 'api', key: KEY } })
const fixture = (status: number) => JSON.parse(readFileSync(new URL(`../../test/fixtures/limits/opencode-go-${status}.json`, import.meta.url), 'utf8'))
const answering = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }))

describe('OpenCode Go limits', () => {
  it('maps all three windows and holds an exhausted month', async () => {
    const fetchImpl = answering(fixture(200))
    const answer = await openCodeUsage(auth(), AT, 1000, fetchImpl)
    expect(answer).toMatchObject({ kind: 'limits', limits: { source: 'api', updatedAt: AT,
      fiveHour: { usedPercentage: 0.5 }, sevenDay: { usedPercentage: 62 }, month: { usedPercentage: 100 } } })
    if (answer.kind === 'limits') expect(exhaustedReset(answer.limits)).toBe('2030-02-01T00:00:00.000Z')
    expect(fetchImpl).toHaveBeenCalledWith(GO_USAGE_URL, expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${KEY}` }) }))
    expect(openCodeLimitsHidden(auth())).toBe(false)
    expect(openCodeLimitsHidden(auth('opencode'))).toBe(false)
    expect((await openCodeUsage(auth('opencode'), AT, 1000, fetchImpl)).kind).toBe('limits')
  })

  it.each([null, {}, { usage: {} }, { usage: { rolling: { percent: 10 } } }])('rejects an incomplete answer: %j', body => {
    expect(goLimits(body, AT)).toBeUndefined()
  })

  it.each([NaN, Infinity, -1, '50', null])('rejects a bad percentage: %s', percent => {
    const body = fixture(200)
    body.usage.weekly.percent = percent
    expect(goLimits(body, AT)).toBeUndefined()
  })

  it('rejects an invalid reset without throwing', () => {
    const body = fixture(200)
    body.usage.monthly.resetsAt = 'tomorrow'
    expect(goLimits(body, AT)).toBeUndefined()
  })

  it('requires a timezone and preserves offset dates', () => {
    const body = fixture(200)
    body.usage.monthly.resetsAt = '2030-02-01T01:00:00'
    expect(goLimits(body, AT)).toBeUndefined()
    body.usage.monthly.resetsAt = '2030-02-01T01:00:00+01:00'
    expect(goLimits(body, AT)?.month?.resetsAt).toBe('2030-02-01T00:00:00.000Z')
  })

  it('treats 403 as Zen and 401 as a key to replace', async () => {
    expect(await goUsage(KEY, AT, 1000, answering(fixture(403), 403))).toMatchObject({ kind: 'missing', reason: { code: 'usage.openCodeNone' } })
    expect(await goUsage(KEY, AT, 1000, answering(fixture(401), 401))).toMatchObject({ kind: 'missing', reason: { code: 'usage.goKeyExpired' } })
    expect(await checkGoKey(KEY, 1000, answering(fixture(403), 403))).toEqual({ state: 'ok' })
    expect(await checkGoKey(KEY, 1000, answering(fixture(401), 401))).toEqual({ state: 'rejected' })
  })

  it('keeps unreadable data and transport failure distinct', async () => {
    expect(await goUsage(KEY, AT, 1000, answering({}))).toMatchObject({ kind: 'unknown', reason: { code: 'usage.goUnread' } })
    await expect(goUsage(KEY, AT, 1000, answering({}, 429))).rejects.toThrow('429')
    await expect(goUsage(KEY, AT, 1000, vi.fn(async () => { throw new Error('offline') }))).rejects.toThrow('offline')
  })

  it('prefers ChatGPT and Copilot over Console, and Go over the legacy Console entry', async () => {
    const held = { 'opencode-go': { type: 'api', key: KEY }, opencode: { type: 'api', key: 'other-console-key' } }
    const fetchImpl = answering(fixture(200))
    await openCodeUsage(JSON.stringify(held), AT, 1000, fetchImpl)
    expect(fetchImpl).toHaveBeenLastCalledWith(GO_USAGE_URL, expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${KEY}` }) }))
    await openCodeUsage(JSON.stringify({ ...held, 'github-copilot': { type: 'oauth', refresh: 'gho_fake' } }), AT, 1000, fetchImpl)
    expect(fetchImpl).toHaveBeenLastCalledWith('https://api.github.com/copilot_internal/user', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'token gho_fake' }) }))
    await openCodeUsage(JSON.stringify({ ...held, openai: { type: 'oauth', access: 'fake-access-go-priority', accountId: 'fake-go-priority' } }), AT, 1000, fetchImpl)
    expect(fetchImpl.mock.calls.at(-1)?.[0]).toBe('https://chatgpt.com/backend-api/wham/usage')
  })
})
