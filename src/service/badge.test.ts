import { describe, expect, it } from 'vitest'
import type { BadgeSettings, BadgeState } from '../badge/model.js'
import type { EvenKeelConfig } from '../config.js'
import type { EvenKeelState } from '../state.js'
import type { PeriodQuery, StatsAnswer, StatsPeriod } from '../stats/model.js'
import { BADGE_STATS_MS, wireBadges } from './badge.js'

const ABC = '11111111-1111-4111-8111-111111111111'
const state = {
  projects: [ABC],
  projectKeys: { [ABC]: 'ABC' },
  config: { projects: { [ABC]: { name: 'Example' } } },
  context: { window: 200_000 },
  tasks: [],
  chain: { active: [], projects: {} },
  sessions: [],
} as unknown as EvenKeelState
const period = { current: { sessions: 4 }, tasks: [{ done: true, cost: 2, priceEstimate: null, activeS: 600 }] } as unknown as StatsPeriod

function rig() {
  let now = Date.parse('2026-11-09T12:00:00Z')
  let badge: BadgeSettings | null = null
  const posts: BadgeState[] = []
  const queries: PeriodQuery[] = []
  let answer: StatsAnswer<StatsPeriod> = { state: 'ok', data: period }
  let down = false
  const lines: string[] = []
  const wiring = wireBadges({
    config: () => ({ settings: { [ABC]: { badge } } }) as unknown as EvenKeelConfig,
    state: () => state,
    period: async (query) => {
      queries.push(query)
      return answer
    },
    now: () => now,
    tz: 'UTC',
    secret: () => 's3cret',
    post: async (_url, _secret, body) => {
      if (down) throw new Error('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND other.example.com') })
      posts.push(JSON.parse(body) as BadgeState)
      return { ok: true, status: 200 }
    },
    get: async () => ({ status: 200, type: 'image/svg+xml' }),
    log: (line) => lines.push(line),
  })
  return {
    wiring,
    posts,
    queries,
    lines,
    down: () => (down = true),
    set: (next: BadgeSettings | null) => (badge = next),
    wait: (ms: number) => (now += ms),
    answer: (next: StatsAnswer<StatsPeriod>) => (answer = next),
  }
}
const on: BadgeSettings = { on: true, url: 'https://badge.example.com', slug: 'example', fields: ['chain', 'sessions', 'medianCost'] }
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('wireBadges', () => {
  it('follows the live config: nothing until the badge is on, a stopped chain once it goes off', async () => {
    const r = rig()
    await r.wiring.tick()
    expect(r.posts).toHaveLength(0)
    r.set(on)
    await r.wiring.tick()
    expect(r.posts).toHaveLength(1)
    r.set({ ...on, on: false })
    await r.wiring.tick()
    expect(r.posts.at(-1)?.chain.state).toBe('stopped')
    expect(r.posts).toHaveLength(2)
  })

  it('reads the project\'s last 30 days from the stats at most every 15 minutes and publishes the picked numbers', async () => {
    const r = rig()
    r.set(on)
    await r.wiring.tick()
    expect(r.posts[0]?.stats).toBeUndefined()
    expect(r.queries).toEqual([{ scope: 'all', account: null, tz: 'UTC', includeTests: true, from: '2026-10-11', to: '2026-11-09', projects: [ABC] }])
    await settle()
    r.wait(2 * 60_000)
    await r.wiring.tick()
    expect(r.posts.at(-1)?.stats).toEqual({ sessions: 4, medianCost: 2 })
    r.wait(BADGE_STATS_MS - 2 * 60_000 - 1)
    r.wiring.svg(ABC, 'dark')
    expect(r.queries).toHaveLength(1)
    r.answer({ state: 'off', reason: 'off' })
    r.wait(1)
    r.wiring.svg(ABC, 'dark')
    await settle()
    r.wait(2 * 60_000)
    await r.wiring.tick()
    expect(r.queries).toHaveLength(2)
    expect(r.posts.at(-1)?.stats).toBeUndefined()
  })

  it('previews a project\'s badge with its picked fields, every field without a setting, none for an unknown project', () => {
    const r = rig()
    expect(r.wiring.svg(ABC, 'light')).toMatch(/^<svg[^>]*aria-label="ABC · Example\. CHAIN STOPPED"/)
    expect(r.wiring.svg('22222222-2222-4222-8222-222222222222', 'dark')).toBeUndefined()
  })

  it('checks an address and a name the dialog gives with the project\'s state and its picked fields, and refuses an unknown project', async () => {
    const r = rig()
    r.set({ ...on, on: false })
    const result = await r.wiring.check(ABC, 'https://other.example.com', 'abc')
    expect(result).toEqual({ ok: true, notice: { code: 'badge.checked', params: {} } })
    expect(r.posts).toHaveLength(1)
    expect(r.posts[0]!.chain.tasks).toEqual([])
    expect(r.posts[0]!.milestone).toBeUndefined()
    await expect(r.wiring.check('22222222-2222-4222-8222-222222222222', 'https://other.example.com', 'abc')).rejects.toThrow()
  })

  it('logs why a Worker did not answer and gives the page only the notice', async () => {
    const r = rig()
    r.down()
    expect(await r.wiring.check(ABC, 'https://other.example.com', 'abc')).toEqual({ ok: false, notice: { code: 'badge.unreachable', params: {} } })
    expect(r.lines.at(-1)).toContain('fetch failed: getaddrinfo ENOTFOUND other.example.com')
  })
})
