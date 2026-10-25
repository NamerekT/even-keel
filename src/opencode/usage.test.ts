import { describe, expect, it, vi } from 'vitest'
import { CHATGPT_USAGE_URL } from '../limits/chatgpt.js'
import { COPILOT_USER_URL } from '../limits/copilot.js'
import { notice } from '../notice/notice.js'
import { openCodeUsage } from './usage.js'

const AT = '2026-10-23T10:00:00.000Z'
const LATER = Date.parse(AT) + 3_600_000

function answering(body: unknown) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(body), { status: 200 }))
}

describe('openCodeUsage', () => {
  it('reports revocation before expiry without changing OpenCode’s sign-in', async () => {
    const auth = JSON.stringify({ openai: { type: 'oauth', access: 'revoked-access', refresh: 'fake-refresh', expires: LATER, accountId: 'revoked-account' } })
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 401 }))
    expect(await openCodeUsage(auth, AT, 1000, fetchImpl)).toEqual({ kind: 'missing', reason: { code: 'usage.chatGptRevoked', params: {} } })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('asks ChatGPT with the access token of a ChatGPT sign-in', async () => {
    const auth = JSON.stringify({ openai: { type: 'oauth', access: 'acc-token', refresh: 'ref', expires: LATER, accountId: 'acc-1' } })
    const fetchImpl = answering({ rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 18000, reset_at: LATER / 1000 } } })
    expect(await openCodeUsage(auth, AT, 1000, fetchImpl)).toMatchObject({ kind: 'limits', limits: { pool: 'chatgpt:acc-1', fiveHour: { usedPercentage: 10 } } })
    expect(fetchImpl.mock.calls[0]![0]).toBe(CHATGPT_USAGE_URL)
    expect(fetchImpl.mock.calls[0]![1]!.headers).toMatchObject({ Authorization: 'Bearer acc-token' })
  })

  it('asks GitHub with the GitHub token of a Copilot sign-in', async () => {
    const auth = JSON.stringify({ 'github-copilot': { type: 'oauth', refresh: 'gho_x', access: 'tid=copilot', expires: 0 } })
    const fetchImpl = answering({ quota_snapshots: { premium_interactions: { entitlement: 50, remaining: 50, unlimited: false } } })
    expect(await openCodeUsage(auth, AT, 1000, fetchImpl)).toMatchObject({ kind: 'limits', limits: { month: { left: 50 } } })
    expect(fetchImpl.mock.calls[0]![0]).toBe(COPILOT_USER_URL)
    expect(fetchImpl.mock.calls[0]![1]!.headers).toMatchObject({ Authorization: 'token gho_x' })
  })

  it('has nothing to ask for the free models or a key', async () => {
    const fetchImpl = answering({})
    const none = { kind: 'missing', reason: notice('usage.openCodeNone', {}) }
    expect(await openCodeUsage(undefined, AT, 1000, fetchImpl)).toEqual(none)
    expect(await openCodeUsage(JSON.stringify({ anthropic: { type: 'api', key: 'sk-ant-x' } }), AT, 1000, fetchImpl)).toEqual(none)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
