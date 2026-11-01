import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountHome } from '../account/homes.js'
import type { RateLimits } from './model.js'
import type { UsageAnswer } from './usage.js'
import { LimitsWatcher } from './watcher.js'

const HOME: AccountHome = { key: 'global', dir: '/home/john/.claude', global: true, agent: 'claude' }
const INTERVAL_MS = 300_000
const HOUR_MS = 3_600_000

const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
const later = (ms: number) => new Date(Date.now() + ms).toISOString()

function snapshot(updatedAt: string, patch: Partial<RateLimits> = {}): RateLimits {
  return {
    fiveHour: { usedPercentage: 12, resetsAt: later(2 * HOUR_MS) },
    sevenDay: { usedPercentage: 69, resetsAt: later(72 * HOUR_MS) },
    updatedAt,
    source: 'usage',
    ...patch,
  }
}

function watcherOf(saved: Map<string, RateLimits>, answers: (() => UsageAnswer)[] = []) {
  const writes: [string, RateLimits | undefined][] = []
  const watcher = new LimitsWatcher({
    file: '/nonexistent/limits.json',
    intervalMs: 60_000,
    homes: () => [HOME],
    ownerOf: () => undefined,
    usage: () => async () => answers.shift()!(),
    usageIntervalMs: INTERVAL_MS,
    online: async () => true,
    offlineRetryMs: 30_000,
    notBefore: () => null,
    accessExpired: () => false,
    ready: () => true,
    apiKey: () => false,
    needsLogin: () => false,
    saved,
    save: (account, limits) => writes.push([account, limits]),
    onChange: () => {},
    onError: () => {},
  })
  const poll = async () => {
    watcher.refresh()
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve))
  }
  return { watcher, writes, poll }
}

const failing = () => {
  throw new Error('timed out')
}

describe('LimitsWatcher with the limits saved before a restart (BTN-631)', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }))
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('shows the saved limits until the first poll answers', async () => {
    const saved = snapshot(ago(60_000))
    const { watcher, poll } = watcherOf(new Map([['global', saved]]), [failing])
    expect(watcher.limits('global')).toEqual(saved)
    await poll()
    expect(watcher.limits('global')).toEqual(saved)
  })

  it('does not show a saved window whose reset has passed', () => {
    const saved = snapshot(ago(6 * HOUR_MS), { fiveHour: { usedPercentage: 90, resetsAt: ago(HOUR_MS) } })
    const { watcher } = watcherOf(new Map([['global', saved]]))
    expect(watcher.limits('global')).toMatchObject({ fiveHour: null, sevenDay: saved.sevenDay })
  })

  it('a saved session report stands for the account as well', () => {
    const saved = snapshot(ago(60_000), { source: 'sdk' })
    const { watcher } = watcherOf(new Map([['global', saved]]))
    expect(watcher.limits('global')).toEqual(saved)
  })

  it('lets the chain go on a snapshot younger than a poll interval, and marks none outdated', () => {
    const { watcher } = watcherOf(new Map([['global', snapshot(ago(60_000))]]))
    expect(watcher.unread('global')).toBe(false)
    expect(watcher.outdated('global')).toBe(false)
  })

  it('keeps the chain waiting on an older snapshot and marks it outdated until a poll answers', async () => {
    const answer: UsageAnswer = { kind: 'limits', limits: snapshot(new Date().toISOString(), { sevenDay: { usedPercentage: 70, resetsAt: later(72 * HOUR_MS) } }) }
    const { watcher, poll } = watcherOf(new Map([['global', snapshot(ago(17 * HOUR_MS))]]), [failing, () => answer])
    expect(watcher.unread('global')).toBe(true)
    expect(watcher.outdated('global')).toBe(true)
    await poll()
    expect(watcher.outdated('global')).toBe(true)
    await poll()
    expect(watcher.unread('global')).toBe(false)
    expect(watcher.outdated('global')).toBe(false)
    expect(watcher.limits('global')?.sevenDay?.usedPercentage).toBe(70)
  })

  it('marks nothing outdated without limits: the account is only unread', () => {
    const { watcher } = watcherOf(new Map())
    expect(watcher.unread('global')).toBe(true)
    expect(watcher.outdated('global')).toBe(false)
  })

  it('saves what a poll told, and forgets it when a poll finds none', async () => {
    const told = snapshot(new Date().toISOString())
    const { watcher, writes, poll } = watcherOf(new Map(), [() => ({ kind: 'limits', limits: told }), () => ({ kind: 'missing', reason: { code: 'usage.noSession', params: {} } })])
    await poll()
    expect(writes).toEqual([['global', told]])
    await poll()
    expect(writes).toEqual([['global', told], ['global', undefined]])
    expect(watcher.limits('global')).toBeNull()
  })

  it('saves a session report over what was known, and does not write the restored limits back', () => {
    const saved = snapshot(ago(60_000))
    const { watcher, writes } = watcherOf(new Map([['global', saved]]))
    watcher.report('global', { sevenDay: { usedPercentage: 71, resetsAt: saved.sevenDay!.resetsAt } }, new Date().toISOString())
    expect(writes).toHaveLength(1)
    expect(writes[0]![1]).toMatchObject({ source: 'sdk', fiveHour: saved.fiveHour, sevenDay: { usedPercentage: 71 } })
  })
})
