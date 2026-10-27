import { describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import { guard, guardHosts, guardToken, isLoopbackHost, TOKEN_COOKIE, type GuardRequest, type GuardSettings } from './guard.js'

const TOKEN = 'f00dfeedcafe0123456789ab'

const local: GuardSettings = { hosts: guardHosts('127.0.0.1', []), token: null }
const open: GuardSettings = { hosts: guardHosts('0.0.0.0', ['pult.example.com']), token: TOKEN }

const request = (fields: Partial<GuardRequest> = {}): GuardRequest => ({
  method: 'GET',
  url: '/',
  host: '127.0.0.1:4747',
  origin: undefined,
  cookie: undefined,
  authorization: undefined,
  remote: '127.0.0.1',
  local: '127.0.0.1',
  ...fields,
})

const fromNetwork = (fields: Partial<GuardRequest> = {}) =>
  request({ host: 'pult.example.com:4747', remote: '192.0.2.7', local: '192.0.2.1', ...fields })

describe('guardHosts', () => {
  it('always lets loopback names in, the configured host unless it is a wildcard, and the extra names', () => {
    expect([...guardHosts('0.0.0.0', ['Pult.Example.com', '[fd00::1]'])].sort()).toEqual(
      ['127.0.0.1', '::1', 'fd00::1', 'localhost', 'pult.example.com'].sort(),
    )
    expect(guardHosts('::', []).has('::')).toBe(false)
    expect(guardHosts('192.0.2.1', []).has('192.0.2.1')).toBe(true)
  })
})

describe('isLoopbackHost', () => {
  it('tells loopback hosts from the ones the network reaches', () => {
    for (const host of ['127.0.0.1', '127.1.2.3', 'localhost', '::1', '[::1]']) expect(isLoopbackHost(host)).toBe(true)
    for (const host of ['0.0.0.0', '::', '192.0.2.1', 'pult.example.com']) expect(isLoopbackHost(host)).toBe(false)
  })
})

describe('guardToken', () => {
  it('needs no token on a loopback host, takes one if given', () => {
    expect(guardToken({}, '127.0.0.1')).toBeNull()
    expect(guardToken({ EVEN_KEEL_TOKEN: TOKEN }, 'localhost')).toBe(TOKEN)
  })

  it('refuses to start on a network host without a token', () => {
    expect(() => guardToken({}, '0.0.0.0')).toThrow(/EVEN_KEEL_TOKEN/)
    expect(() => guardToken({ EVEN_KEEL_TOKEN: '  ' }, '192.0.2.1')).toThrow(/EVEN_KEEL_TOKEN/)
  })

  it('refuses a token that is short or would break the cookie', () => {
    expect(() => guardToken({ EVEN_KEEL_TOKEN: 'short' }, '0.0.0.0')).toThrow(/EVEN_KEEL_TOKEN/)
    expect(() => guardToken({ EVEN_KEEL_TOKEN: 'a;b=c d0123456789abcdef' }, '127.0.0.1')).toThrow(/EVEN_KEEL_TOKEN/)
  })
})

describe('guard: Host', () => {
  it('lets loopback names in with any port', () => {
    for (const host of ['localhost:4747', '127.0.0.1', '[::1]:4747', 'LOCALHOST:5173']) {
      expect(guard(local, request({ host }))).toEqual({ kind: 'pass' })
    }
  })

  it('refuses a foreign name even from loopback: that is DNS rebinding', () => {
    expect(guard(local, request({ host: 'evil.example.net:4747' }))).toMatchObject({ kind: 'refuse', status: 403 })
    expect(guard(local, request({ url: '/api/events', host: 'evil.example.net' }))).toMatchObject({ kind: 'refuse', status: 403 })
  })

  it('refuses a request without a Host or with one that is not a host', () => {
    expect(guard(local, request({ host: undefined }))).toMatchObject({ kind: 'refuse', status: 403 })
    expect(guard(local, request({ host: 'a/b@c' }))).toMatchObject({ kind: 'refuse', status: 403 })
  })

  it('lets a name from allowedHosts in, as a proxy on the same machine sends it', () => {
    expect(guard(open, request({ host: 'pult.example.com' }))).toEqual({ kind: 'pass' })
  })
})

describe('guard: Origin', () => {
  it('lets a request without Origin in: hooks and curl send none', () => {
    expect(guard(local, request({ method: 'POST', url: '/api/chain/start' }))).toEqual({ kind: 'pass' })
  })

  it('lets the page itself in, whatever allowed name it was opened by', () => {
    expect(guard(local, request({ method: 'POST', origin: 'http://localhost:5173' }))).toEqual({ kind: 'pass' })
    expect(guard(open, request({ method: 'POST', host: 'pult.example.com', origin: 'https://pult.example.com' }))).toEqual({ kind: 'pass' })
  })

  it('refuses another site posting to the page', () => {
    expect(guard(local, request({ method: 'POST', origin: 'https://evil.example.net' }))).toMatchObject({ kind: 'refuse', status: 403 })
    expect(guard(local, request({ method: 'POST', origin: 'null' }))).toMatchObject({ kind: 'refuse', status: 403 })
  })
})

describe('guard: token', () => {
  const callback = '/api/profiles/oauth/callback'
  const oauthCookie = (expires = Date.now() + 600_000, token = TOKEN) =>
    `even-keel-oauth=${expires}.${createHmac('sha256', token).update(`oauth-callback:${expires}`).digest('base64url')}`

  it('accepts the separate callback cookie only on the exact GET callback', () => {
    const cookie = oauthCookie()
    expect(guard(open, fromNetwork({ url: `${callback}?code=code&state=state`, cookie }))).toEqual({ kind: 'pass' })
    for (const url of ['/', '/api/state', `${callback}/extra`, '/api/profiles/oauth/start']) {
      expect(guard(open, fromNetwork({ url, cookie }))).toMatchObject({ kind: 'refuse', status: 401 })
    }
    expect(guard(open, fromNetwork({ method: 'POST', url: callback, cookie }))).toMatchObject({ kind: 'refuse', status: 401 })
    expect(guard(open, fromNetwork({ url: callback, authorization: `Bearer ${cookie.split('=')[1]}` }))).toMatchObject({ kind: 'refuse', status: 401 })
  })

  it('refuses an expired, forged or old-token callback cookie', () => {
    for (const cookie of [oauthCookie(Date.now() - 1), oauthCookie(Date.now() + 600_000, 'other-token-0123456789'), 'even-keel-oauth=forged', `even-keel-oauth=${TOKEN}`]) {
      expect(guard(open, fromNetwork({ url: callback, cookie }))).toMatchObject({ kind: 'refuse', status: 401 })
    }
  })

  it('checks Host and Origin before the callback cookie too', () => {
    const cookie = oauthCookie()
    expect(guard(open, fromNetwork({ url: callback, host: 'evil.example.net', cookie }))).toMatchObject({ kind: 'refuse', status: 403 })
    expect(guard(open, fromNetwork({ url: callback, origin: 'https://evil.example.net', cookie }))).toMatchObject({ kind: 'refuse', status: 403 })
  })

  it('does not ask a request from this machine for it', () => {
    expect(guard(open, request({ host: 'pult.example.com', remote: '::ffff:127.0.0.1' }))).toEqual({ kind: 'pass' })
    expect(guard(open, request({ host: '192.0.2.1:4747', remote: '192.0.2.1', local: '192.0.2.1' }))).toMatchObject({ kind: 'refuse', status: 403 })
    expect(guard({ ...open, hosts: guardHosts('192.0.2.1', []) }, request({ host: '192.0.2.1:4747', remote: '::ffff:192.0.2.1', local: '::ffff:192.0.2.1' }))).toEqual({
      kind: 'pass',
    })
  })

  it('asks a request from the network for it', () => {
    expect(guard(open, fromNetwork())).toMatchObject({ kind: 'refuse', status: 401 })
    expect(guard(open, fromNetwork({ cookie: `${TOKEN_COOKIE}=wrong-token-0123456789` }))).toMatchObject({ kind: 'refuse', status: 401 })
    expect(guard({ ...open, token: null }, fromNetwork())).toMatchObject({ kind: 'refuse', status: 401 })
  })

  it('takes it from the cookie or a bearer header', () => {
    expect(guard(open, fromNetwork({ cookie: `theme=dark; ${TOKEN_COOKIE}=${TOKEN}` }))).toEqual({ kind: 'pass' })
    expect(guard(open, fromNetwork({ method: 'POST', authorization: `Bearer ${TOKEN}` }))).toEqual({ kind: 'pass' })
  })

  it('turns ?token= into a cookie and drops it from the address', () => {
    expect(guard(open, fromNetwork({ url: `/stats?tab=week&token=${TOKEN}` }))).toEqual({
      kind: 'enter',
      location: '/stats?tab=week',
      cookie: `${TOKEN_COOKIE}=${TOKEN}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`,
    })
    expect(guard(open, fromNetwork({ url: `/?token=${TOKEN}` }))).toMatchObject({ kind: 'enter', location: '/' })
  })

  it('refuses a wrong ?token= and takes none on a POST', () => {
    expect(guard(open, fromNetwork({ url: '/?token=wrong-token-0123456789' }))).toMatchObject({ kind: 'refuse', status: 401 })
    expect(guard(open, fromNetwork({ method: 'POST', url: `/api/chain/start?token=${TOKEN}` }))).toMatchObject({ kind: 'refuse', status: 401 })
  })

  it('checks Host and Origin before the token', () => {
    expect(guard(open, fromNetwork({ host: 'evil.example.net', cookie: `${TOKEN_COOKIE}=${TOKEN}` }))).toMatchObject({ status: 403 })
    expect(guard(open, fromNetwork({ method: 'POST', origin: 'https://evil.example.net', cookie: `${TOKEN_COOKIE}=${TOKEN}` }))).toMatchObject({
      status: 403,
    })
  })
})
