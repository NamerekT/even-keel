import { describe, expect, it } from 'vitest'
import { checkBadge, type BadgeCheckDeps } from './check.js'
import type { BadgeState } from './model.js'

const state: BadgeState = { v: 1, at: 'ignored', project: { key: 'ABC', name: 'Example' }, active: [], chain: { state: 'idle', next: null } }
const target = { url: 'https://badge.example.com/', slug: 'example' }

function deps(over: Partial<BadgeCheckDeps> = {}) {
  const calls: string[] = []
  const all: BadgeCheckDeps = {
    secret: 's3cret',
    state,
    now: () => Date.parse('2026-11-09T12:00:00Z'),
    post: async (url) => {
      calls.push(`POST ${url}`)
      return { ok: true, status: 204 }
    },
    get: async (url) => {
      calls.push(`GET ${url}`)
      return { status: 200, type: 'image/svg+xml; charset=utf-8' }
    },
    ...over,
  }
  return { deps: all, calls }
}

describe('checkBadge', () => {
  it('pushes the state, then reads the dark picture, and says the Worker draws the badge', async () => {
    const { deps: d, calls } = deps()
    expect(await checkBadge(target, d)).toEqual({ ok: true, notice: { code: 'badge.checked', params: {} } })
    expect(calls).toEqual(['POST https://badge.example.com/push/example', 'GET https://badge.example.com/example.svg?theme=dark'])
  })

  it('pushes the state with the time of the check', async () => {
    let body = ''
    const { deps: d } = deps({
      post: async (_url, _secret, sent) => {
        body = sent
        return { ok: true, status: 204 }
      },
    })
    await checkBadge(target, d)
    expect(JSON.parse(body)).toEqual({ ...state, at: '2026-11-09T12:00:00.000Z' })
  })

  it('refuses a bad address or name, and a missing secret, before any request', async () => {
    const { deps: d, calls } = deps()
    expect((await checkBadge({ url: 'badge.example.com', slug: 'example' }, d)).notice.code).toBe('badge.url')
    expect((await checkBadge({ url: '', slug: 'example' }, d)).notice.code).toBe('badge.url')
    expect((await checkBadge({ url: target.url, slug: 'Bad slug' }, d)).notice.code).toBe('badge.slug')
    expect((await checkBadge(target, { ...d, secret: ' ' })).notice.code).toBe('badge.noSecret')
    expect(calls).toEqual([])
  })

  it('names each refusal of the push by its status', async () => {
    const answer = (status: number) => deps({ post: async () => ({ ok: false, status }) }).deps
    expect(await checkBadge(target, answer(401))).toEqual({ ok: false, notice: { code: 'badge.refused', params: {} } })
    expect((await checkBadge(target, answer(404))).notice.code).toBe('badge.notWorker')
    expect((await checkBadge(target, answer(400))).notice.code).toBe('badge.rejected')
    expect((await checkBadge(target, answer(503))).notice).toEqual({ code: 'badge.pushStatus', params: { status: 503 } })
  })

  it('says the Worker did not answer when the push throws, the network error kept for the log only', async () => {
    const { deps: d } = deps({
      post: async () => {
        throw new Error('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND badge.example.com') })
      },
    })
    expect(await checkBadge(target, d)).toEqual({
      ok: false,
      notice: { code: 'badge.unreachable', params: {} },
      cause: 'fetch failed: getaddrinfo ENOTFOUND badge.example.com',
    })
  })

  it('fails a pushed badge whose picture does not come back as SVG', async () => {
    const status = deps({ get: async () => ({ status: 500, type: 'text/plain' }) }).deps
    expect((await checkBadge(target, status)).notice).toEqual({ code: 'badge.imageStatus', params: { status: 500 } })
    const html = deps({ get: async () => ({ status: 200, type: 'text/html' }) }).deps
    expect((await checkBadge(target, html)).notice.code).toBe('badge.notSvg')
    const thrown = deps({
      get: async () => {
        throw new Error('timeout')
      },
    }).deps
    expect(await checkBadge(target, thrown)).toEqual({ ok: false, notice: { code: 'badge.unreachable', params: {} }, cause: 'timeout' })
  })
})
