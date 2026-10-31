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
  accounts: { ready: () => boolean; apiKey: () => boolean; needsLogin?: () => boolean } = { ready: () => true, apiKey: () => false },
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
    needsLogin: accounts.needsLogin ?? (() => false),
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

  it('does not ask a signed-out account, and starts polling after sign-in', async () => {
    let needsLogin = true
    const { watcher, asked, errors, poll } = watcherOf([() => LIMITS], () => true, {
      ready: () => true, apiKey: () => false, needsLogin: () => needsLogin,
    })
    await poll()
    expect(asked).toEqual([])
    expect(errors).toEqual([])
    needsLogin = false
    await poll()
    expect(asked).toEqual(['global'])
    expect(watcher.usage('global').state).toBe('ok')
  })

  it('hides and forgets an unreadable poll when the account needs sign-in', async () => {
    let needsLogin = false
    const unread: UsageAnswer = { kind: 'unknown', reason: { code: 'usage.noSession', params: {} } }
    const { watcher, asked, poll } = watcherOf([() => unread], () => true, {
      ready: () => true, apiKey: () => false, needsLogin: () => needsLogin,
    })
    await poll()
    expect(watcher.usage('global').state).toBe('unread')
    needsLogin = true
    expect(watcher.usage('global').state).toBe('waiting')
    await poll()
    needsLogin = false
    expect(watcher.usage('global').state).toBe('waiting')
    expect(asked).toEqual(['global'])
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

  it('counts the account unread until a poll answers, even past a lone failure', async () => {
    const { watcher, poll } = watcherOf([failing, () => LIMITS])
    expect(watcher.unread('global')).toBe(true)
    await poll()
    expect(watcher.unread('global')).toBe(true)
    await poll()
    expect(watcher.unread('global')).toBe(false)
  })

  it('counts the account read once its polls keep failing, so a chain does not wait for ever', async () => {
    const { watcher, poll } = watcherOf([failing, failing])
    await poll()
    await poll()
    expect(watcher.unread('global')).toBe(false)
  })

  it('does not count unread an account that is never polled', () => {
    expect(watcherOf([], () => true, { ready: () => true, apiKey: () => true }).watcher.unread('global')).toBe(false)
    expect(watcherOf([], () => true, { ready: () => true, apiKey: () => false, needsLogin: () => true }).watcher.unread('global')).toBe(false)
    expect(watcherOf([]).watcher.unread('other')).toBe(false)
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

  it('keeps the newer windows when a poll answers with older ones', async () => {
    const newer = { ...polled.limits, sevenDay: window(100), updatedAt: '2026-01-01T12:10:00.000Z' }
    const { watcher, poll } = watcherOf([() => ({ kind: 'limits', limits: newer }), () => polled])
    await poll()
    await poll()
    expect(watcher.limits('global')).toMatchObject({ sevenDay: window(100), updatedAt: '2026-01-01T12:10:00.000Z' })
    expect(watcher.usage('global').state).toBe('ok')
  })

  it('shows nothing for an API account', () => {
    const { watcher } = watcherOf([], () => true, { ready: () => true, apiKey: () => true })
    watcher.report('global', { fiveHour: window(18) }, '2026-01-01T12:01:00.000Z')
    expect(watcher.limits('global')).toBeNull()
  })
})

describe('LimitsWatcher.spendMonth', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }))
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  const month = { usedPercentage: 90.7, resetsAt: '2099-01-01T00:00:00.000Z', left: 28 }
  const polled: UsageAnswer = { kind: 'limits', limits: { fiveHour: null, sevenDay: null, month, updatedAt: '2026-01-01T12:00:00.000Z', source: 'api' } }

  it('shows the month spent from a refusal until a newer poll', async () => {
    const later = { ...polled, limits: { ...polled.limits, updatedAt: '2026-01-01T12:10:00.000Z' } } as UsageAnswer
    const { watcher, poll } = watcherOf([() => polled, () => later])
    await poll()
    watcher.spendMonth('global', '2026-01-01T12:02:00.000Z')
    expect(watcher.limits('global')).toMatchObject({ month: { usedPercentage: 100, left: 0, resetsAt: month.resetsAt }, updatedAt: '2026-01-01T12:02:00.000Z' })
    await poll()
    expect(watcher.limits('global')).toMatchObject({ month: { left: 28 }, updatedAt: '2026-01-01T12:10:00.000Z' })
  })

  it('leaves alone a poll newer than the refusal and an account with no month', async () => {
    const { watcher, poll } = watcherOf([() => polled])
    await poll()
    watcher.spendMonth('global', '2026-01-01T11:59:00.000Z')
    expect(watcher.limits('global')).toMatchObject({ month: { left: 28 }, updatedAt: '2026-01-01T12:00:00.000Z' })
    const { watcher: none } = watcherOf([])
    none.spendMonth('global', '2026-01-01T12:02:00.000Z')
    expect(none.limits('global')).toBeNull()
  })
})
