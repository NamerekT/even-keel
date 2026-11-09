import { describe, expect, it } from 'vitest'
import type { BadgeSettings, BadgeState } from './model.js'
import { BADGE_MIN_GAP_MS, BADGE_PULSE_MS, BadgePusher } from './push.js'

const MIN = 60_000
const settings: BadgeSettings = { on: true, url: 'https://badge.example.com/', slug: 'example', fields: [] }
const state = (next: string): BadgeState => ({ v: 1, at: 'ignored', project: { key: 'ABC', name: 'Example' }, active: [], chain: { state: 'idle', next } })

function rig() {
  let now = Date.parse('2026-11-09T12:00:00Z')
  let next = 'ABC-1'
  let on = true
  let secret: string | undefined = 's3cret'
  let answer: () => Promise<{ ok: boolean; status: number }> = async () => ({ ok: true, status: 200 })
  const posts: { url: string; secret: string; body: BadgeState }[] = []
  const log: string[] = []
  const pusher = new BadgePusher({
    targets: () => (on ? [{ project: 'p-1', settings, state: () => state(next) }] : []),
    secret: () => secret,
    post: async (url, key, body) => {
      posts.push({ url, secret: key, body: JSON.parse(body) as BadgeState })
      return answer()
    },
    now: () => now,
    log: (line) => log.push(line),
  })
  return {
    pusher,
    posts,
    log,
    wait: (ms: number) => (now += ms),
    set: (value: string) => (next = value),
    off: () => (on = false),
    noSecret: () => (secret = undefined),
    fail: (with_: () => Promise<{ ok: boolean; status: number }>) => (answer = with_),
  }
}

describe('BadgePusher', () => {
  it('pushes the first state at once, to the slug on the Worker, with the secret and the time of the push', async () => {
    const { pusher, posts } = rig()
    await pusher.tick()
    expect(posts).toHaveLength(1)
    expect(posts[0]).toMatchObject({ url: 'https://badge.example.com/push/example', secret: 's3cret', body: { chain: { next: 'ABC-1' }, at: '2026-11-09T12:00:00.000Z' } })
  })

  it('holds a change until two minutes passed since the last push, then sends the latest', async () => {
    const r = rig()
    await r.pusher.tick()
    r.wait(MIN)
    r.set('ABC-2')
    await r.pusher.tick()
    expect(r.posts).toHaveLength(1)
    r.set('ABC-3')
    r.wait(BADGE_MIN_GAP_MS - MIN)
    await r.pusher.tick()
    expect(r.posts.map((post) => post.body.chain.next)).toEqual(['ABC-1', 'ABC-3'])
  })

  it('sends nothing without a change until the 15-minute pulse', async () => {
    const r = rig()
    await r.pusher.tick()
    r.wait(BADGE_PULSE_MS - 1)
    await r.pusher.tick()
    expect(r.posts).toHaveLength(1)
    r.wait(1)
    await r.pusher.tick()
    expect(r.posts).toHaveLength(2)
  })

  it('sends a last state with the chain stopped when the badge goes off, then nothing', async () => {
    const r = rig()
    await r.pusher.tick()
    r.off()
    await r.pusher.tick()
    expect(r.posts.at(-1)?.body.chain).toEqual({ state: 'stopped', next: 'ABC-1' })
    r.wait(BADGE_PULSE_MS * 2)
    await r.pusher.tick()
    expect(r.posts).toHaveLength(2)
  })

  it('logs a failure once per reason and retries by the same schedule', async () => {
    const r = rig()
    r.fail(async () => ({ ok: false, status: 503 }))
    await r.pusher.tick()
    r.wait(MIN)
    await r.pusher.tick()
    expect(r.posts).toHaveLength(1)
    r.wait(MIN)
    await r.pusher.tick()
    expect(r.posts).toHaveLength(2)
    expect(r.log).toEqual(['badge: the push of p-1 to https://badge.example.com/push/example failed: HTTP 503; retrying every 2 min'])
    r.fail(async () => {
      throw new Error('fetch failed')
    })
    r.wait(BADGE_MIN_GAP_MS)
    await r.pusher.tick()
    expect(r.log.at(-1)).toMatch(/failed: fetch failed/)
    r.fail(async () => ({ ok: true, status: 200 }))
    r.wait(BADGE_MIN_GAP_MS)
    await r.pusher.tick()
    expect(r.log.at(-1)).toBe('badge: p-1 pushes again')
    expect(r.log).toHaveLength(3)
  })

  it('pushes nothing without the secret and says so once', async () => {
    const r = rig()
    r.noSecret()
    await r.pusher.tick()
    r.wait(BADGE_PULSE_MS)
    await r.pusher.tick()
    expect(r.posts).toHaveLength(0)
    expect(r.log).toEqual(['badge: EVEN_KEEL_BADGE_SECRET is not set, no badge is pushed'])
  })
})
