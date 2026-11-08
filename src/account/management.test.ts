import { describe, expect, it } from 'vitest'
import { memoryDatabase } from '../storage/memory.js'
import { forgetManagementKey, loadManagementKeys, readOpenRouterBalance, saveManagementKey } from './management.js'

const KEY = 'sk-or-v1-management-fake-0000000000'
const json = (status: number, body: unknown): typeof fetch => async () => new Response(JSON.stringify(body), { status })

describe('readOpenRouterBalance (BTN-868)', () => {
  it('asks /api/v1/credits with the management key and gives what is left of the credits', async () => {
    let seen: { url: string; headers: Headers } | undefined
    const fetchImpl: typeof fetch = async (url, init) => {
      seen = { url: String(url), headers: new Headers(init?.headers) }
      return new Response(JSON.stringify({ data: { total_credits: 100.5, total_usage: 25.75 } }), { status: 200 })
    }
    expect(await readOpenRouterBalance(KEY, 1000, fetchImpl)).toEqual({ state: 'ok', usd: 74.75 })
    expect(seen?.url).toBe('https://openrouter.ai/api/v1/credits')
    expect(seen?.headers.get('authorization')).toBe(`Bearer ${KEY}`)
  })

  it('takes 401 and 403 for a key that is no management key of a live account', async () => {
    expect(await readOpenRouterBalance(KEY, 1000, json(401, {}))).toEqual({ state: 'rejected' })
    expect(await readOpenRouterBalance(KEY, 1000, json(403, {}))).toEqual({ state: 'rejected' })
  })

  it('knows nothing from another status, no answer or an answer without the two sums', async () => {
    expect(await readOpenRouterBalance(KEY, 1000, json(500, {}))).toEqual({ state: 'unknown', reason: 'HTTP 500' })
    expect(await readOpenRouterBalance(KEY, 1000, json(200, { data: { total_credits: 10 } }))).toEqual({ state: 'unknown', reason: 'no credits in the answer' })
    expect(await readOpenRouterBalance(KEY, 1000, async () => new Response('not json', { status: 200 }))).toEqual({ state: 'unknown', reason: 'no credits in the answer' })
    const down: typeof fetch = async () => {
      throw new TypeError('fetch failed')
    }
    expect(await readOpenRouterBalance(KEY, 1000, down)).toEqual({ state: 'unknown', reason: 'fetch failed' })
  })
})

describe('the management keys of the accounts (BTN-868)', { timeout: 30_000 }, () => {
  it('keeps the last key saved per account and forgets a removed one', async () => {
    const db = await memoryDatabase()
    expect(await loadManagementKeys(db)).toEqual(new Map())
    await saveManagementKey(db, 'router', 'sk-or-v1-old-fake', new Date('2026-11-08T10:00:00.000Z'))
    await saveManagementKey(db, 'router', KEY, new Date('2026-11-08T11:00:00.000Z'))
    await saveManagementKey(db, 'other', 'sk-or-v1-other-fake', new Date('2026-11-08T11:00:00.000Z'))
    expect(await loadManagementKeys(db)).toEqual(new Map([['other', 'sk-or-v1-other-fake'], ['router', KEY]]))
    await forgetManagementKey(db, 'router')
    expect(await loadManagementKeys(db)).toEqual(new Map([['other', 'sk-or-v1-other-fake']]))
  })
})
