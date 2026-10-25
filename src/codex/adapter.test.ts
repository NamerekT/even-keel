import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '../agent/contract.js'

const AT = '2026-10-25T10:00:00.000Z'
const RESET = Date.parse('2026-10-25T12:00:00.000Z') / 1000
const AUTH = { auth_mode: 'chatgpt', tokens: { access_token: 'fake-access', account_id: 'example-account' } }
const PLUS = { rate_limit: { primary_window: { used_percent: 12, limit_window_seconds: 18000, reset_at: RESET } } }
const home = { key: 'example', dir: '', agent: 'codex' as const }
let dir: string
let agent: Agent

beforeEach(async () => {
  vi.resetModules()
  await mkdir('.temp', { recursive: true })
  dir = await mkdtemp(join('.temp', 'codex-usage-'))
  home.dir = dir
  await writeFile(join(dir, 'auth.json'), JSON.stringify(AUTH))
  const sessions = join(dir, 'sessions', '2026', '10', '25')
  await mkdir(sessions, { recursive: true })
  await writeFile(join(sessions, 'rollout-example-00000000-0000-0000-0000-000000000001.jsonl'), JSON.stringify({
    timestamp: '2026-10-24T10:00:00.000Z', type: 'event_msg', payload: {
      type: 'token_count', rate_limits: { primary: { used_percent: 90, window_minutes: 300, resets_at: RESET } },
    },
  }) + '\n')
  const { codex } = await import('./adapter.js')
  agent = codex.setup({ env: () => ({}), timeoutMs: 1000, workDir: dir, checkedCli: () => false, log: () => {}, onCliChange: () => {} })
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(dir, { recursive: true, force: true })
})

function answering(status: number, body: unknown) {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetchImpl)
  return fetchImpl
}

describe('Codex usage', () => {
  it('prefers ChatGPT to an older rollout and sends the folder’s sign-in', async () => {
    const fetchImpl = answering(200, PLUS)
    expect(await agent.usage!(home, AT)).toMatchObject({ kind: 'limits', limits: {
      source: 'api', updatedAt: AT, pool: 'chatgpt:example-account', fiveHour: { usedPercentage: 12 },
    } })
    expect(fetchImpl).toHaveBeenCalledWith('https://chatgpt.com/backend-api/wham/usage', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer fake-access', 'ChatGPT-Account-Id': 'example-account' }),
    }))
  })

  it.each([401, 403, 502])('falls back to the rollout on HTTP %s', async (status) => {
    const fetchImpl = answering(status, {})
    expect(await agent.usage!(home, AT)).toMatchObject({ kind: 'limits', limits: {
      pool: 'chatgpt:example-account', fiveHour: { usedPercentage: 90 },
    } })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('falls back on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')))
    expect(await agent.usage!(home, AT)).toMatchObject({ kind: 'limits', limits: { fiveHour: { usedPercentage: 90 } } })
  })

  it('reads the free plan’s month without any rollouts', async () => {
    await rm(join(dir, 'sessions'), { recursive: true })
    answering(200, { plan_type: 'free', rate_limit: { primary_window: { used_percent: 35, limit_window_seconds: 2592000, reset_at: RESET } } })
    expect(await agent.usage!(home, AT)).toMatchObject({ kind: 'limits', limits: {
      fiveHour: null, sevenDay: null, month: { usedPercentage: 35 }, source: 'api',
    } })
  })

  it('keeps the rollout path for an API key', async () => {
    await writeFile(join(dir, 'auth.json'), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-fake' }))
    const fetchImpl = answering(200, PLUS)
    expect(await agent.usage!(home, AT)).toMatchObject({ kind: 'limits', limits: { fiveHour: { usedPercentage: 90 } } })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('falls back when ChatGPT has no readable windows', async () => {
    answering(200, { rate_limit: null })
    expect(await agent.usage!(home, AT)).toMatchObject({ kind: 'limits', limits: { fiveHour: { usedPercentage: 90 } } })
  })

  it('has no data when the request fails and there are no rollouts', async () => {
    await rm(join(dir, 'sessions'), { recursive: true })
    answering(401, {})
    expect(await agent.usage!(home, AT)).toMatchObject({ kind: 'missing', reason: { code: 'usage.noRollout' } })
  })

  it('shares a pending request and its result with OpenCode, then polls again after five minutes', async () => {
    const fetchImpl = answering(200, PLUS)
    const { openCodeUsage } = await import('../opencode/usage.js')
    const auth = JSON.stringify({ openai: { type: 'oauth', access: 'another-fake-access', accountId: 'example-account' } })
    const [codex, openCode] = await Promise.all([agent.usage!(home, AT), openCodeUsage(auth, AT, 1000)])
    expect(codex).toEqual(openCode)
    await openCodeUsage(auth, '2026-10-25T10:04:59.000Z', 1000)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await agent.usage!(home, '2026-10-25T10:05:00.000Z')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('lets OpenCode use its own valid token after Codex’s token was refused', async () => {
    const fetchImpl = answering(401, {})
    await agent.usage!(home, AT)
    fetchImpl.mockImplementation(async () => new Response(JSON.stringify(PLUS), { status: 200 }))
    const { openCodeUsage } = await import('../opencode/usage.js')
    const auth = JSON.stringify({ openai: { type: 'oauth', access: 'another-fake-access', accountId: 'example-account' } })
    expect(await openCodeUsage(auth, AT, 1000)).toMatchObject({ kind: 'limits', limits: { fiveHour: { usedPercentage: 12 } } })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
