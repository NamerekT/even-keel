import { describe, expect, it } from 'vitest'
import { ContextWindows } from './windows.js'

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
