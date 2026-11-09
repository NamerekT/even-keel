import { describe, expect, it } from 'vitest'
import { ContextWindows, type SavedWindow } from './windows.js'

/** The cache whose `peek` needs no task: the probe below does not read it. */
function windows(answers: Record<string, number | null | Error>) {
  const { cache: inner, state } = cacheOf(answers)
  const cache = { peek: (account: string, model: string) => inner.peek(account, model, 'ABC-1'), idle: () => inner.idle() }
  return { cache, state }
}

function cacheOf(answers: Record<string, number | null | Error>) {
  const state = { now: 0, stamp: 'v1', probes: [] as string[], errors: [] as unknown[] }
  const cache = new ContextWindows({
    probe: async (account, model) => {
      state.probes.push(`${account}/${model}`)
      const answer = answers[model]
      if (answer instanceof Error) throw answer
      return answer ?? null
    },
    stamp: async () => state.stamp,
    recheckMs: 60_000,
    now: () => state.now,
    onError: (error) => state.errors.push(error),
  })
  return { cache, state }
}

describe('ContextWindows', () => {
  it('separates the windows of launch settings on the same account and model', async () => {
    const cache = new ContextWindows({
      probe: async (_account, _model, _task, settings) => settings === undefined ? 250_000 : JSON.parse(settings).autoCompactWindow,
      stamp: async () => 'v1', recheckMs: 60_000, onError: () => {},
    })
    cache.peek('a', 'opus', 'ABC-1', '{"autoCompactWindow":300000}')
    cache.peek('a', 'opus', 'XYZ-1', '{"autoCompactWindow":400000}')
    cache.peek('a', 'opus', 'OLD-1')
    await cache.idle()
    expect(cache.peek('a', 'opus', 'ABC-1', '{"autoCompactWindow":300000}')).toBe(300_000)
    expect(cache.peek('a', 'opus', 'XYZ-1', '{"autoCompactWindow":400000}')).toBe(400_000)
    expect(cache.peek('a', 'opus', 'OLD-1')).toBe(250_000)
  })

  it('knows nothing at first, asks the agent in the background, and answers from then on without asking again', async () => {
    const { cache, state } = windows({ opus: 250_000 })
    expect(cache.peek('mykey', 'opus')).toBeNull()
    expect(cache.peek('mykey', 'opus')).toBeNull()
    await cache.idle()
    expect(cache.peek('mykey', 'opus')).toBe(250_000)
    state.now = 59_000
    expect(cache.peek('mykey', 'opus')).toBe(250_000)
    await cache.idle()
    expect(state.probes).toEqual(['mykey/opus'])
  })

  it('keeps one answer per account and model', async () => {
    const { cache, state } = windows({ opus: 250_000, 'opus[1m]': 1_000_000 })
    cache.peek('a', 'opus')
    cache.peek('a', 'opus[1m]')
    cache.peek('b', 'opus')
    await cache.idle()
    expect([cache.peek('a', 'opus'), cache.peek('a', 'opus[1m]'), cache.peek('b', 'opus')]).toEqual([250_000, 1_000_000, 250_000])
    expect(state.probes).toEqual(['a/opus', 'a/opus[1m]', 'b/opus'])
  })

  it('asks again only once the stamp changed: a new CLI or edited settings', async () => {
    const answers: Record<string, number> = { opus: 250_000 }
    const { cache, state } = windows(answers)
    cache.peek('a', 'opus')
    await cache.idle()
    state.now = 61_000
    expect(cache.peek('a', 'opus')).toBe(250_000)
    await cache.idle()
    expect(state.probes).toHaveLength(1)

    answers.opus = 400_000
    state.stamp = 'v2'
    state.now = 122_000
    expect(cache.peek('a', 'opus')).toBe(250_000)
    await cache.idle()
    expect(cache.peek('a', 'opus')).toBe(400_000)
    expect(state.probes).toHaveLength(2)
  })

  it('answers at once from the windows saved before a restart and asks again only for a changed stamp', async () => {
    const asked: string[] = []
    const saved: SavedWindow[] = []
    const cache = new ContextWindows({
      probe: async (account, model) => {
        asked.push(`${account}/${model}`)
        return 300_000
      },
      stamp: async (account) => (account === 'a' ? 'v1' : 'v2'),
      recheckMs: 60_000,
      now: () => 5_000,
      onError: () => {},
      saved: [
        { account: 'a', model: 'opus', settings: '{"autoCompactWindow":250000}', stamp: 'v1', window: 250_000, measuredAt: 1 },
        { account: 'b', model: 'opus', settings: null, stamp: 'v1', window: 200_000, measuredAt: 1 },
      ],
      save: (window) => saved.push(window),
    })
    expect(cache.peek('a', 'opus', 'ABC-1', '{"autoCompactWindow":250000}')).toBe(250_000)
    expect(cache.peek('b', 'opus', 'ABC-2')).toBe(200_000)
    await cache.idle()
    expect(asked).toEqual(['b/opus'])
    expect(cache.peek('b', 'opus', 'ABC-2')).toBe(300_000)
    expect(saved).toEqual([{ account: 'b', model: 'opus', settings: null, stamp: 'v2', window: 300_000, measuredAt: 5_000 }])
  })

  it('asks the agent one question at a time', async () => {
    let running = 0
    let most = 0
    const cache = new ContextWindows({
      probe: async () => {
        most = Math.max(most, ++running)
        await new Promise((resolve) => setTimeout(resolve, 5))
        running--
        return 250_000
      },
      stamp: async () => 'v1', recheckMs: 60_000, onError: () => {},
    })
    for (const account of ['a', 'b', 'c']) for (const model of ['opus', 'sonnet']) cache.peek(account, model, 'ABC-1')
    await cache.idle()
    expect(most).toBe(1)
    expect(cache.peek('c', 'sonnet', 'ABC-1')).toBe(250_000)
  })

  it('keeps what it knew when the agent fails, reports it and asks again after the recheck time', async () => {
    const answers: Record<string, number | Error> = { opus: 250_000 }
    const { cache, state } = windows(answers)
    cache.peek('a', 'opus')
    await cache.idle()
    answers.opus = new Error('exit code 1')
    state.stamp = 'v2'
    state.now = 61_000
    cache.peek('a', 'opus')
    await cache.idle()
    expect(cache.peek('a', 'opus')).toBe(250_000)
    expect(state.errors).toHaveLength(1)
    state.now = 90_000
    cache.peek('a', 'opus')
    await cache.idle()
    expect(state.probes).toHaveLength(2)
    answers.opus = 300_000
    state.now = 122_000
    cache.peek('a', 'opus')
    await cache.idle()
    expect(cache.peek('a', 'opus')).toBe(300_000)
  })
})
