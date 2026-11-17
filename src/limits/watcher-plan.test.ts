import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountHome } from '../account/homes.js'
import type { RateLimits } from './model.js'
import type { UsageAnswer } from './usage.js'
import { LimitsWatcher } from './watcher.js'

const WORK: AccountHome = { key: 'work', dir: '/home/john/.claude-accounts/work', global: false, agent: 'claude' }
const OWN: AccountHome = { key: 'own', dir: '/home/john/.claude-accounts/own', global: false, agent: 'claude' }
const INTERVAL_MS = 300_000
const HOUR_MS = 3_600_000

const later = (ms: number) => new Date(Date.now() + ms).toISOString()
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

function limits(updatedAt: string, used = 12): RateLimits {
  return { fiveHour: { usedPercentage: used, resetsAt: later(2 * HOUR_MS) }, sevenDay: null, updatedAt, source: 'usage' }
}

function watcherOf(planFirst = false) {
  const asked: string[] = []
  const watcher = new LimitsWatcher({
    planFirst,
    file: '/nonexistent/limits.json',
    intervalMs: 60_000,
    homes: () => [WORK, OWN],
    ownerOf: () => undefined,
    usage: (home) => async () => {
      asked.push(home.key)
      return { kind: 'limits', limits: limits(new Date().toISOString(), 5) } as UsageAnswer
    },
    usageIntervalMs: INTERVAL_MS,
    online: async () => true,
    offlineRetryMs: 30_000,
    notBefore: () => null,
    accessExpired: () => false,
    ready: () => true,
    apiKey: () => false,
    needsLogin: () => false,
    onChange: () => {},
    onError: () => {},
  })
  const poll = async () => {
    watcher.refresh()
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve))
  }
  return { watcher, asked, poll }
}

describe('LimitsWatcher and the hub plan (BTN-991)', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }))
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('does not poll a folder another machine polls, and its chain does not wait for a poll of it', async () => {
    const { watcher, asked, poll } = watcherOf()
    watcher.plan({ skip: ['work'] })
    await poll()
    expect(asked).toEqual(['own'])
    expect(watcher.skipped('work')).toBe(true)
    expect(watcher.unread('work')).toBe(false)
    expect(watcher.usage('work').state).toBe('ok')
  })

  it('shows the limits the hub handed over when they are newer than its own', async () => {
    const { watcher, poll } = watcherOf()
    await poll()
    const handed = limits(later(60_000), 70)
    watcher.plan({ picture: { work: handed } })
    expect(watcher.limits('work')?.fiveHour?.usedPercentage).toBe(70)
    watcher.plan({ picture: { work: limits(ago(HOUR_MS), 90) } })
    expect(watcher.limits('work')?.fiveHour?.usedPercentage).toBe(70)
  })

  it('lets a chain go on with fresh limits the hub handed over before its own first poll', () => {
    const { watcher } = watcherOf()
    watcher.plan({ picture: { work: limits(new Date().toISOString(), 40) } })
    expect(watcher.unread('work')).toBe(false)
  })

  it('polls a folder it skipped no sooner than a poll interval after the hub gave it back', async () => {
    const { watcher, asked, poll } = watcherOf()
    watcher.plan({ skip: ['work'] })
    await poll()
    watcher.plan({ skip: [] })
    await poll()
    expect(asked).toEqual(['own', 'own'])
    // The round's own timer comes a poll interval later.
    vi.advanceTimersByTime(INTERVAL_MS)
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve))
    expect(asked).toEqual(['own', 'own', 'work', 'own'])
  })

  it('on a machine on the network, does not poll before the hub sent its first plan (BTN-1247)', async () => {
    const { watcher, asked } = watcherOf(true)
    const settle = async () => {
      for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve))
    }
    watcher.start()
    watcher.refresh()
    await settle()
    expect(asked).toEqual([])
    watcher.plan({ skip: ['work'] })
    await settle()
    expect(asked).toEqual(['own'])
  })

  it('on a machine on the network, a plan before the start polls only once started', async () => {
    const { watcher, asked } = watcherOf(true)
    const settle = async () => {
      for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve))
    }
    watcher.plan({ skip: [] })
    await settle()
    expect(asked).toEqual([])
    watcher.start()
    await settle()
    expect(asked).toEqual(['work', 'own'])
  })

  it('says which folders it could poll', () => {
    const { watcher } = watcherOf()
    expect(watcher.pollable('work')).toBe(true)
    expect(watcher.pollable('gone')).toBe(false)
  })
})
