import { describe, expect, it } from 'vitest'
import type { BadgeState } from './badge/model.js'
import { badgeMode, renderBadge } from './badge/render.js'
import { handle, type BadgeStore, type Env } from './worker.js'

const SECRET = 'test-secret'
const now = new Date('2026-11-09T12:00:00Z')
const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString()

const state: BadgeState = {
  v: 1,
  at: at(1),
  project: { key: 'ABC', name: 'Example' },
  active: [{ key: 'ABC-15', titleEn: 'Draw the badge', agent: 'claude', model: 'opus', startedAt: at(20), state: 'working', action: { tool: 'Edit', text: 'Edit src/x.ts' }, context: 48 }],
  chain: { state: 'running', next: 'ABC-16', tasks: [{ key: 'ABC-15', state: 'working' }] },
  milestone: { name: 'v1', done: 4, left: 2 },
  stats: { sessions: 12, medianCost: 1.2, medianMinutes: 18 },
}

class FakeStore implements BadgeStore {
  readonly data = new Map<string, string>()
  writes = 0
  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null
  }
  async put(key: string, value: string): Promise<void> {
    this.writes += 1
    this.data.set(key, value)
  }
}

function envOf(store = new FakeStore()): Env & { BADGE: FakeStore } {
  return { BADGE: store, BADGE_SECRET: SECRET }
}

const push = (env: Env, body: unknown, secret = SECRET, slug = 'example') =>
  handle(
    new Request(`https://badge.example.com/push/${slug}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    env,
    now,
  )

const show = (env: Env, path = '/example.svg', headers: Record<string, string> = {}) => handle(new Request(`https://badge.example.com${path}`, { headers }), env, now)

describe('POST /push/<slug>', () => {
  it('stores a valid state under the slug', async () => {
    const env = envOf()
    const response = await push(env, state)
    expect(response.status).toBe(204)
    expect(JSON.parse(env.BADGE.data.get('example')!)).toEqual(state)
  })

  it('refuses a wrong or missing secret with 401 and writes nothing', async () => {
    const env = envOf()
    expect((await push(env, state, 'wrong')).status).toBe(401)
    const bare = await handle(new Request('https://badge.example.com/push/example', { method: 'POST', body: JSON.stringify(state) }), env, now)
    expect(bare.status).toBe(401)
    expect(env.BADGE.writes).toBe(0)
  })

  it('refuses every push while the Worker has no secret', async () => {
    const env: Env & { BADGE: FakeStore } = { BADGE: new FakeStore() }
    expect((await push(env, state, '')).status).toBe(401)
    expect((await push(env, state, 'anything')).status).toBe(401)
    expect(env.BADGE.writes).toBe(0)
  })

  it.each([
    ['not JSON', '{'],
    ['another version', { ...state, v: 2 }],
    ['no project', { ...state, project: undefined }],
    ['a bad time', { ...state, at: 'yesterday' }],
    ['a bad chain state', { ...state, chain: { ...state.chain, state: 'flying' } }],
    ['a task without a key', { ...state, active: [{ state: 'working' }] }],
    ['a task in a bad state', { ...state, active: [{ key: 'ABC-1', state: 'done' }] }],
    ['a context that is no number', { ...state, active: [{ ...state.active[0], context: '48' }] }],
    ['a null stats', { ...state, stats: null }],
    ['a chip in a bad state', { ...state, chain: { ...state.chain, tasks: [{ key: 'ABC-1', state: 'lost' }] } }],
    ['a body over 64 KB', { ...state, project: { key: 'ABC', name: 'x'.repeat(70_000) } }],
  ])('refuses %s with 400', async (_name, body) => {
    const env = envOf()
    expect((await push(env, body)).status).toBe(400)
    expect(env.BADGE.writes).toBe(0)
  })

  it('accepts a state with only the required keys', async () => {
    const env = envOf()
    const bare = { v: 1, at: at(0), project: { key: 'ABC', name: 'Example' }, active: [{ key: 'ABC-1', state: 'waiting' }], chain: { state: 'idle', next: null } }
    expect((await push(env, bare)).status).toBe(204)
  })

  it('does not know a bad slug', async () => {
    const env = envOf()
    expect((await push(env, state, SECRET, 'Bad_Slug')).status).toBe(404)
    expect(env.BADGE.writes).toBe(0)
  })
})

describe('GET /<slug>.svg', () => {
  const seeded = (minutesAgo: number, chain: BadgeState['chain']['state'] = 'running') => {
    const env = envOf()
    env.BADGE.data.set('example', JSON.stringify({ ...state, at: at(minutesAgo), chain: { ...state.chain, state: chain } }))
    return env
  }

  it('draws the stored state as an SVG that is never cached', async () => {
    const response = await show(seeded(1))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-cache, max-age=0')
    expect(response.headers.get('etag')).toMatch(/^"[0-9a-f]{64}"$/)
    const svg = await response.text()
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('Draw the badge')
  })

  it.each([
    [1, 'running', 'live'],
    [20, 'running', 'stale'],
    [90, 'running', 'offline'],
    [1, 'paused', 'still'],
  ] as const)('draws a state %i min old with the chain %s as %s, counted at the request', async (minutesAgo, chain, mode) => {
    const env = seeded(minutesAgo, chain)
    const stored = JSON.parse(env.BADGE.data.get('example')!) as BadgeState
    expect(badgeMode(stored, now)).toBe(mode)
    const svg = await (await show(env)).text()
    expect(svg).toBe(renderBadge(stored, { theme: 'dark', now }))
    if (mode === 'offline') expect(svg).toContain('OFFLINE · last seen')
    if (mode === 'live') expect(svg).toContain('ek-ring')
  })

  it('draws "not published yet" for a slug without a state', async () => {
    const response = await show(envOf(), '/nobody.svg')
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('NOT PUBLISHED YET')
  })

  it('takes the light theme only by name', async () => {
    const env = seeded(1)
    const dark = await (await show(env)).text()
    const light = await (await show(env, '/example.svg?theme=light')).text()
    const other = await (await show(env, '/example.svg?theme=blue')).text()
    expect(light).not.toBe(dark)
    expect(other).toBe(dark)
  })

  it('answers 304 to the same ETag and 200 to another', async () => {
    const env = seeded(1)
    const first = await show(env)
    const etag = first.headers.get('etag')!
    const again = await show(env, '/example.svg', { 'if-none-match': etag })
    expect(again.status).toBe(304)
    expect(again.headers.get('etag')).toBe(etag)
    expect(again.headers.get('cache-control')).toBe('no-cache, max-age=0')
    expect(await again.text()).toBe('')
    expect((await show(env, '/example.svg', { 'if-none-match': `W/${etag}, "other"` })).status).toBe(304)
    expect((await show(env, '/example.svg', { 'if-none-match': '"other"' })).status).toBe(200)
  })

  it('draws a stored value it cannot read as not published', async () => {
    const env = envOf()
    env.BADGE.data.set('example', '{')
    expect(await (await show(env)).text()).toContain('NOT PUBLISHED YET')
  })
})

describe('other requests', () => {
  it.each([
    ['GET', '/'],
    ['GET', '/push/example'],
    ['GET', '/example.png'],
    ['GET', '/a/example.svg'],
    ['PUT', '/push/example'],
    ['POST', '/example.svg'],
  ])('%s %s is 404', async (method, path) => {
    const env = envOf()
    const response = await handle(new Request(`https://badge.example.com${path}`, { method, headers: { authorization: `Bearer ${SECRET}` }, body: method === 'GET' ? null : JSON.stringify(state) }), env, now)
    expect(response.status).toBe(404)
    expect(env.BADGE.writes).toBe(0)
  })
})
