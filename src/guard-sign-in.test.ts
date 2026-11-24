import { describe, expect, it } from 'vitest'
import type { AccessToken } from './access/store.js'
import { guard, guardHosts, TOKEN_COOKIE, type DeviceBook, type GuardRequest, type GuardSettings } from './guard.js'

const KEY = 'f00dfeedcafe0123456789ab'
const SECRET = 'device-secret-0123456789abcdefghijklmnopqrstu'
const REVOKED = 'revoked-secret-0123456789abcdefghijklmnopqrst'

const device: AccessToken = {
  id: 't1',
  person: 'p1',
  rights: 'owner',
  device: 'Firefox on Linux',
  createdAt: '2026-11-24T08:00:00.000Z',
  seenAt: null,
  seenFrom: null,
  revokedAt: null,
  keyMark: null,
}

const book: DeviceBook = {
  find: (secret) => (secret === SECRET ? device : undefined),
  seen: () => {},
  signIn: async () => ({ token: device, secret: SECRET }),
  signInOn: () => false,
}

const proxied: GuardSettings = { hosts: guardHosts('127.0.0.1', ['hub.example.com']), token: KEY, book }

const request = (fields: Partial<GuardRequest> = {}): GuardRequest => ({
  method: 'GET',
  url: '/api/state',
  host: 'hub.example.com',
  origin: undefined,
  contentType: undefined,
  cookie: undefined,
  authorization: undefined,
  remote: '127.0.0.1',
  local: '127.0.0.1',
  ...fields,
})

describe('guard: signing in (BTN-1619)', () => {
  it('asks a request by a name of allowedHosts for a sign-in even from loopback, when the key is set', () => {
    expect(guard(proxied, request())).toMatchObject({ kind: 'refuse', status: 401 })
    expect(guard(proxied, request({ method: 'POST', url: '/api/chain/start', contentType: 'application/json' }))).toMatchObject({ kind: 'refuse', status: 401 })
  })

  it('lets a request to localhost or 127.0.0.1 from this machine in without one', () => {
    for (const host of ['localhost:4747', '127.0.0.1:4747', '[::1]:4747']) expect(guard(proxied, request({ host }))).toEqual({ kind: 'pass' })
  })

  it('lets the hooks of a session on this machine in by any allowed name', () => {
    expect(guard(proxied, request({ url: '/api/sessions/abc/checkpoint' }))).toEqual({ kind: 'pass' })
    expect(guard(proxied, request({ method: 'POST', url: '/api/sessions/abc/permission', contentType: 'application/json' }))).toEqual({ kind: 'pass' })
    expect(guard(proxied, request({ url: '/api/sessions/abc/checkpoint', remote: '192.0.2.7' }))).toMatchObject({ kind: 'refuse', status: 401 })
  })

  it('takes a device token from the cookie or a bearer header, the owner key only as a bearer', () => {
    expect(guard(proxied, request({ cookie: `theme=dark; ${TOKEN_COOKIE}=${SECRET}` }))).toEqual({ kind: 'pass', device })
    expect(guard(proxied, request({ authorization: `Bearer ${SECRET}` }))).toEqual({ kind: 'pass', device })
    expect(guard(proxied, request({ authorization: `Bearer ${KEY}` }))).toEqual({ kind: 'pass' })
    // A cookie of the key itself was the sign-in before device tokens: the page asks for the key once.
    expect(guard(proxied, request({ cookie: `${TOKEN_COOKIE}=${KEY}` }))).toMatchObject({ kind: 'refuse', status: 401 })
  })

  it('refuses a revoked token', () => {
    expect(guard(proxied, request({ cookie: `${TOKEN_COOKIE}=${REVOKED}` }))).toMatchObject({ kind: 'refuse', status: 401 })
    expect(guard(proxied, request({ remote: '192.0.2.7', local: '192.0.2.1', cookie: `${TOKEN_COOKIE}=${REVOKED}` }))).toMatchObject({ kind: 'refuse', status: 401 })
  })

  it('lets the page files and the sign-in routes in without a sign-in, as a visit', () => {
    expect(guard(proxied, request({ url: '/' }))).toEqual({ kind: 'visit' })
    expect(guard(proxied, request({ url: '/assets/index.js' }))).toEqual({ kind: 'visit' })
    expect(guard(proxied, request({ method: 'POST', url: '/api/auth/key', contentType: 'application/json' }))).toEqual({ kind: 'visit' })
    expect(guard(proxied, request({ method: 'POST', url: '/api/auth/key', contentType: 'text/plain' }))).toMatchObject({ kind: 'refuse', status: 415 })
    expect(guard(proxied, request({ method: 'POST', url: '/' }))).toMatchObject({ kind: 'refuse', status: 401 })
  })

  it('turns an old link with ?token= into a sign-in with the key and drops it from the address', () => {
    expect(guard(proxied, request({ url: `/stats?tab=week&token=${KEY}` }))).toEqual({ kind: 'signIn', location: '/stats?tab=week' })
    expect(guard(proxied, request({ url: '/?token=wrong-token-0123456789' }))).toEqual({ kind: 'visit' })
  })

  it('without the key lets this machine in by any allowed name, as before', () => {
    const open: GuardSettings = { ...proxied, token: null }
    expect(guard(open, request())).toEqual({ kind: 'pass' })
    expect(guard(open, request({ remote: '192.0.2.7', local: '192.0.2.1' }))).toMatchObject({ kind: 'refuse', status: 401 })
  })
})

describe('guard: the sign-in an invitation turned on, without the key (BTN-1656)', () => {
  const invited: GuardSettings = { ...proxied, token: null, book: { ...book, signInOn: () => true } }

  it('asks a proxy name for a sign-in as with the key, loopback names and the hooks still pass', () => {
    expect(guard(invited, request())).toMatchObject({ kind: 'refuse', status: 401 })
    expect(guard(invited, request({ url: '/' }))).toEqual({ kind: 'visit' })
    expect(guard(invited, request({ method: 'POST', url: '/api/auth/invite/open', contentType: 'application/json' }))).toEqual({ kind: 'visit' })
    expect(guard(invited, request({ host: 'localhost:4747' }))).toEqual({ kind: 'pass' })
    expect(guard(invited, request({ url: '/api/sessions/abc/checkpoint' }))).toEqual({ kind: 'pass' })
  })

  it('lets a device token in, and no key of any kind', () => {
    expect(guard(invited, request({ cookie: `${TOKEN_COOKIE}=${SECRET}` }))).toEqual({ kind: 'pass', device })
    expect(guard(invited, request({ authorization: `Bearer ${KEY}` }))).toMatchObject({ kind: 'refuse', status: 401 })
    expect(guard(invited, request({ url: `/?token=${KEY}` }))).toEqual({ kind: 'visit' })
  })

  it('off, or with no book, leaves the hub as before: this machine passes by any name', () => {
    expect(guard({ ...invited, book: { ...book, signInOn: () => false } }, request())).toEqual({ kind: 'pass' })
    expect(guard({ ...invited, book: undefined }, request())).toEqual({ kind: 'pass' })
  })
})
