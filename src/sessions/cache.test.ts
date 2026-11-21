import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { AGENTS } from '../agent/adapters.js'
import { byTrial, trialTtl, ttlWithin, WARM_CACHE_MS, warmCacheMs } from './cache.js'
import type { CacheTtl, CacheWindow } from './transcript.js'

const MINUTE = 60_000
const workDir = mkdtempSync(join(tmpdir(), 'even-keel-cache-'))
afterAll(() => rmSync(workDir, { recursive: true, force: true }))

function windowOf(agent: string, cache: CacheTtl | null, apiKey: boolean): number {
  const setUp = AGENTS[agent]!.setup({ env: () => ({}), timeoutMs: 1000, workDir, checkedCli: () => false, log: () => {}, onCliChange: () => {} })
  const written: CacheWindow | null = cache === null ? null : { ttl: cache, until: '2026-10-29T12:00:00.000Z' }
  return setUp.warmMs?.(written, apiKey) ?? WARM_CACHE_MS
}

describe('the warm window', () => {
  it('is each lifetime less a margin, five minutes when unknown', () => {
    expect([warmCacheMs('5m'), warmCacheMs('30m'), warmCacheMs('1h'), warmCacheMs(null)]).toEqual([4 * MINUTE, 25 * MINUTE, 55 * MINUTE, 4 * MINUTE])
  })

  it('names a written cache by the longest lifetime it outlives, a minute of drift allowed', () => {
    expect([ttlWithin(5 * MINUTE), ttlWithin(29.5 * MINUTE), ttlWithin(30 * MINUTE), ttlWithin(12 * 60 * MINUTE), ttlWithin(MINUTE)]).toEqual(['5m', '30m', '30m', '1h', '5m'])
  })

  it("is Claude's written lifetime, an hour on a subscription and five minutes on a key without one", () => {
    expect(windowOf('claude', '5m', false)).toBe(4 * MINUTE)
    expect(windowOf('claude', '1h', false)).toBe(55 * MINUTE)
    expect(windowOf('claude', null, false)).toBe(55 * MINUTE)
    expect(windowOf('claude', '1h', true)).toBe(55 * MINUTE)
    expect(windowOf('claude', '5m', true)).toBe(4 * MINUTE)
    expect(windowOf('claude', null, true)).toBe(4 * MINUTE)
  })

  it('is half an hour for Codex whatever the account, as the rollout does not say', () => {
    expect([windowOf('codex', null, false), windowOf('codex', null, true)]).toEqual([25 * MINUTE, 25 * MINUTE])
  })

  it("is Copilot's written lifetime, half an hour without one", () => {
    expect([windowOf('copilot', '30m', true), windowOf('copilot', '5m', false), windowOf('copilot', null, true)]).toEqual([25 * MINUTE, 4 * MINUTE, 25 * MINUTE])
  })

  it('stays an hour for OpenCode: DeepSeek keeps its cache for hours', () => {
    expect([windowOf('opencode', null, false), windowOf('opencode', null, true)]).toEqual([55 * MINUTE, 55 * MINUTE])
  })
})

describe("the cache trial's variant (BTN-1412)", () => {
  it("is the number's second bit: 0 and 1 mod 4 five minutes, 2 and 3 an hour, whatever the parity", () => {
    expect(['ABC-4', 'ABC-5', 'ABC-6', 'ABC-7', 'ABC_GH-1412', 'ABC-1413'].map(trialTtl)).toEqual(['5m', '5m', '1h', '1h', '5m', '5m'])
  })

  it('is none for a name without a number at its end', () => {
    expect(['ABC-FIX', 'ABC-CARRY', 'ABC', 'ABC-12x'].map(trialTtl)).toEqual([null, null, null, null])
  })
})

describe("the cache trial's mark on a session (BTN-1412)", () => {
  const view = (task: string, ttl: CacheTtl | null, agent = 'claude') => ({ task, agent, cache: ttl === null ? null : { ttl, until: '2026-11-21T12:00:00.000Z' } })

  it("is on a Claude chain session whose written lifetime is its number's variant, while the trial is on", () => {
    expect(byTrial(view('ABC-8', '5m'), true)).toBe(true)
    expect(byTrial(view('ABC-10', '1h'), true)).toBe(true)
  })

  it('is off when the trial is off, the lifetime differs or is not written yet, for another agent, a chat or a fix', () => {
    expect(byTrial(view('ABC-8', '5m'), false)).toBe(false)
    expect(byTrial(view('ABC-8', '1h'), true)).toBe(false)
    expect(byTrial(view('ABC-8', null), true)).toBe(false)
    expect(byTrial(view('ABC-10', '1h', 'codex'), true)).toBe(false)
    expect(byTrial(view('chat-123456789012', '5m'), true)).toBe(false)
    expect(byTrial(view('ABC-FIX', '5m'), true)).toBe(false)
  })
})
