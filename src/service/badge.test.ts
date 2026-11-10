import { describe, expect, it } from 'vitest'
import type { BadgeSettings, BadgeState } from '../badge/model.js'
import type { EvenKeelConfig } from '../config.js'
import type { EvenKeelState } from '../state.js'
import type { PeriodQuery, StatsAnswer, StatsPeriod } from '../stats/model.js'
import { BADGE_STATS_MS, wireBadges } from './badge.js'
import { BadgeTranslations } from '../badge/translate.js'
import { memoryDatabase } from '../storage/memory.js'

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

function rig(snapshot = state, translations?: BadgeTranslations) {
  let now = Date.parse('2026-11-09T12:00:00Z')
  let badge: BadgeSettings | null = null
  const posts: BadgeState[] = []
  const queries: PeriodQuery[] = []
  let answer: StatsAnswer<StatsPeriod> = { state: 'ok', data: period }
  let down = false
  const lines: string[] = []
  const identities: string[] = []
  const wiring = wireBadges({
    config: () => ({ projects: { [ABC]: 'C:/repos/example' }, keys: { [ABC]: 'ABC' }, trackers: { [ABC]: 'builtin' }, trackerProjects: {}, feeds: {}, settings: { [ABC]: { badge } } }) as unknown as EvenKeelConfig,
    state: () => snapshot,
    translations,
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
    machine: { user: 'jdoe', host: 'FAKE-PC', home: null, env: {} },
    identity: async (repo) => {
      identities.push(repo)
      return { name: 'John Doe', email: 'john@example.com' }
    },
  })
  return {
    wiring,
    posts,
    queries,
    lines,
    identities,
    down: () => (down = true),
    set: (next: BadgeSettings | null) => (badge = next),
    wait: (ms: number) => (now += ms),
    answer: (next: StatsAnswer<StatsPeriod>) => (answer = next),
  }
}
const on: BadgeSettings = { on: true, url: 'https://badge.example.com', slug: 'example', fields: ['chain', 'sessions', 'medianCost'] }
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('wireBadges', () => {
  it('translates only current tasks when the badge and English titles are on, and uses the cache in previews', async () => {
    const db = await memoryDatabase()
    const calls: string[] = []
    const translations = new BadgeTranslations(db, {
      env: () => ({ TALLY_LLM_URL: 'https://llm.example.com', TALLY_LLM_KEY: 'fake-key' }),
      request: async (_url, init) => {
        calls.push(JSON.parse(init!.body as string).messages[1].content)
        return new Response(JSON.stringify({ choices: [{ message: { content: 'Fix the badge' } }], model: 'google-gemini-test' }))
      },
    })
    const snapshot = { ...state, tasks: [
      { project: ABC, id: 'ABC-1', title: 'Починить бейдж', status: { category: 'Started' }, milestone: null },
      { project: ABC, id: 'ABC-2', title: 'Не отправлять', status: { category: 'ToDo' }, milestone: null },
    ], chain: { ...state.chain, active: [{ project: ABC, current: { task: 'ABC-1', sessionId: null, since: '2026-11-09T12:00:00Z' } }] } } as unknown as EvenKeelState
    const r = rig(snapshot, translations)
    r.wiring.svg(ABC, 'dark')
    await translations.settle()
    expect(calls).toEqual([])
    r.set(on)
    await r.wiring.tick()
    await translations.settle()
    expect(calls).toEqual([])
    r.set({ ...on, fields: ['title'] })
    await r.wiring.tick()
    await translations.settle()
    expect(calls).toEqual(['Починить бейдж'])
    expect(r.wiring.svg(ABC, 'dark')).toContain('Fix the badge')
    r.wait(2 * 60_000)
    await r.wiring.tick()
    expect(r.posts.at(-1)?.active[0]?.titleEn).toBe('Fix the badge')
    r.set({ ...on, on: false, fields: ['title'] })
    expect(r.wiring.svg(ABC, 'dark')).toContain('Fix the badge')
    expect(calls).toHaveLength(1)
  })

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

  describe('the filter of private data', () => {
    const working = (lines: { text: string; description?: string }[]): EvenKeelState => ({
      ...state,
      tasks: [{ project: ABC, id: 'ABC-1', title: 'Task', status: { category: 'Started' }, milestone: null }],
      chain: { ...state.chain, active: [{ project: ABC, current: { task: 'ABC-1', sessionId: 's1', since: '2026-11-09T12:00:00Z' } }] },
      sessions: [{
        sessionId: 's1', task: 'ABC-1', agent: 'claude', model: null, asking: false, lamp: 'working', contextTokens: 0, contextWindow: null, action: null,
        feed: lines.map((line) => ({ kind: 'tool', text: line.text, badge: { tool: 'Bash', text: line.description === undefined ? 'Bash' : `Bash ${line.description}` } })),
      }],
    }) as unknown as EvenKeelState
    const fields: BadgeSettings = { ...on, fields: ['action'] }

    it('publishes nothing free until the repository\'s git identity is read, and reads it at most every 15 minutes', async () => {
      const r = rig(working([{ text: 'Bash npm test', description: 'Run the tests' }]))
      r.set(fields)
      await r.wiring.tick()
      expect(r.posts[0]!.active[0]!.action).toBeNull()
      expect(r.lines).toEqual([])
      await settle()
      r.wait(2 * 60_000)
      await r.wiring.tick()
      expect(r.posts.at(-1)!.active[0]!.action).toEqual({ tool: 'Bash', text: 'Bash Run the tests' })
      r.wait(BADGE_STATS_MS - 2 * 60_000 - 1)
      r.wiring.svg(ABC, 'dark')
      expect(r.identities).toEqual(['C:/repos/example'])
      r.wait(1)
      r.wiring.svg(ABC, 'dark')
      expect(r.identities).toHaveLength(2)
    })

    it('pushes and previews the same filtered state, and logs a reason once without the text', async () => {
      const r = rig(working([{ text: 'Bash ssh', description: 'Copy the build to FAKE-PC for John' }]))
      r.set(fields)
      r.wiring.svg(ABC, 'dark')
      await settle()
      const svg = r.wiring.svg(ABC, 'dark')!
      await r.wiring.tick()
      r.wait(2 * 60_000)
      await r.wiring.tick()
      await r.wiring.check(ABC, 'https://other.example.com', 'abc')
      for (const post of r.posts) expect(post.active[0]!.action).toEqual({ tool: 'Bash', text: 'Bash' })
      expect(svg).not.toContain('FAKE-PC')
      expect(svg).not.toContain('redacted')
      const logged = r.lines.filter((line) => line.includes('left out'))
      expect(logged).toEqual(['badge: ABC: the action text is left out, it names this machine, an account, a profile or another project (layer 1)'])
      expect(r.lines.join('\n')).not.toContain('FAKE-PC')
    })

    it('names the pattern layer in the log', async () => {
      const r = rig(working([{ text: 'Bash curl', description: 'Ping 192.168.1.10' }]))
      r.set(fields)
      r.wiring.svg(ABC, 'dark')
      await settle()
      expect(r.wiring.svg(ABC, 'dark')).not.toContain('192.168')
      expect(r.lines).toEqual(['badge: ABC: the action text is left out, it looks like a secret, a contact, an address or a path (layer 2)'])
    })
  })

  it('logs why a Worker did not answer and gives the page only the notice', async () => {
    const r = rig()
    r.down()
    expect(await r.wiring.check(ABC, 'https://other.example.com', 'abc')).toEqual({ ok: false, notice: { code: 'badge.unreachable', params: {} } })
    expect(r.lines.at(-1)).toContain('fetch failed: getaddrinfo ENOTFOUND other.example.com')
  })
})
