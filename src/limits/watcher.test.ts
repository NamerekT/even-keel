import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountHome } from '../account/homes.js'
import type { UsageAnswer } from './usage.js'
import { LimitsWatcher } from './watcher.js'

const HOME: AccountHome = { key: 'global', dir: '/home/john/.claude', global: true, agent: 'claude' }
const LIMITS: UsageAnswer = {
  kind: 'limits',
  limits: { fiveHour: { usedPercentage: 16, resetsAt: 2_000_000_000 }, sevenDay: { usedPercentage: 36, resetsAt: 2_000_000_000 } },
} as unknown as UsageAnswer

function watcherOf(
  answers: (() => UsageAnswer)[],
  online: () => boolean = () => true,
  accounts: { ready: () => boolean; apiKey: () => boolean } = { ready: () => true, apiKey: () => false },
) {
  const errors: string[] = []
  const asked: string[] = []
  const watcher = new LimitsWatcher({
    file: '/nonexistent/limits.json',
    intervalMs: 60_000,
    homes: () => [HOME],
    ownerOf: () => undefined,
    usage: (home) => async () => {
      asked.push(home.key)
      return answers.shift()!()
    },
    usageIntervalMs: 300_000,
    online: async () => online(),
    offlineRetryMs: 30_000,
    notBefore: () => null,
    accessExpired: () => false,
    ready: accounts.ready,
    apiKey: accounts.apiKey,
    onChange: () => {},
    onError: (error) => errors.push(String(error)),
  })
  const poll = async () => {
    watcher.refresh()
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve))
  }
  return { watcher, errors, asked, poll }
}

const failing = () => {
  throw new Error('exit code 1 / network down')
}

describe('LimitsWatcher', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }))
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('shows a failed /usage call only when the next poll fails too', async () => {
    const { watcher, errors, poll } = watcherOf([failing, failing])
    await poll()
    expect(watcher.usage('global').state).toBe('waiting')
    expect(errors).toEqual([expect.stringContaining('retrying at the next poll: exit code 1 / network down')])
    await poll()
    expect(watcher.usage('global').state).toBe('unread')
    expect(watcher.usage('global').reason?.detail).toBe('exit code 1 / network down')
  })

  it('forgets a failed call once a poll answers', async () => {
    const { watcher, poll } = watcherOf([() => LIMITS, failing, () => LIMITS, failing])
    for (let i = 0; i < 4; i++) await poll()
    expect(watcher.usage('global').state).toBe('ok')
  })

  it('does not ask /usage while the network is down, and asks again soon after', async () => {
    let up = false
    const { watcher, errors, asked, poll } = watcherOf([() => LIMITS], () => up)
    await poll()
    expect(asked).toEqual([])
    expect(errors).toEqual([])
    expect(watcher.usage('global').state).toBe('waiting')
    up = true
    vi.advanceTimersByTime(30_000)
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve))
    expect(asked).toEqual(['global'])
    expect(watcher.usage('global').state).toBe('ok')
  })

  it('does not ask /usage before the accounts are read, so an API account is not asked at the start', async () => {
    let ready = false
    const { watcher, errors, asked, poll } = watcherOf([], () => true, { ready: () => ready, apiKey: () => ready })
    await poll()
    expect(asked).toEqual([])
    expect(watcher.deferred).toBe(true)
    vi.advanceTimersByTime(300_000)
    expect(asked).toEqual([])
    ready = true
    await poll()
    expect(watcher.deferred).toBe(false)
    expect(asked).toEqual([])
    expect(errors).toEqual([])
  })
})

describe('LimitsWatcher.report', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }))
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  const window = (usedPercentage: number) => ({ usedPercentage, resetsAt: '2099-01-01T00:00:00.000Z' })
  const polled: UsageAnswer = {
    kind: 'limits',
    limits: { fiveHour: window(16), sevenDay: window(36), updatedAt: '2026-01-01T12:00:00.000Z', source: 'usage' },
  }

  it('shows a session\'s windows over the last poll until a newer poll', async () => {
    const answers = [() => polled, () => ({ ...polled, limits: { ...polled.limits, updatedAt: '2026-01-01T12:10:00.000Z' } }) as UsageAnswer]
    const { watcher, poll } = watcherOf(answers)
    await poll()
    watcher.report('global', { fiveHour: window(18) }, '2026-01-01T12:01:00.000Z')
    expect(watcher.limits('global')).toEqual({ fiveHour: window(18), sevenDay: window(36), updatedAt: '2026-01-01T12:01:00.000Z', source: 'sdk' })
    watcher.report('global', { sevenDay: window(37) }, '2026-01-01T12:02:00.000Z')
    expect(watcher.limits('global')).toMatchObject({ fiveHour: window(18), sevenDay: window(37), source: 'sdk' })
    await poll()
    expect(watcher.limits('global')).toMatchObject({ fiveHour: window(16), source: 'usage' })
  })

  it('shows nothing for an API account', () => {
    const { watcher } = watcherOf([], () => true, { ready: () => true, apiKey: () => true })
    watcher.report('global', { fiveHour: window(18) }, '2026-01-01T12:01:00.000Z')
    expect(watcher.limits('global')).toBeNull()
  })
})
