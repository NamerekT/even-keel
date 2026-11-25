import { request, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { FakeAuthenticator } from './access/authenticator.fixture.js'
import { AccessBook } from './access/book.js'
import { InviteDesk } from './access/invites.js'
import { PageOrigins } from './access/origins.js'
import { PasskeyDesk } from './access/passkeys.js'
import { RateLimit } from './access/rate.js'
import { INVITE_CALLS, INVITE_COOKIE } from './access/routes.js'
import type { DevicesView, InviteMade } from './access/view.js'
import { EventHub } from './events.js'
import { guardHosts, TOKEN_COOKIE } from './guard.js'
import { createEvenKeelServer, type ServerDeps } from './server.js'
import { memoryDatabase } from './storage/memory.js'

const KEY = 'owner-key-0123456789abcdef'
const HOST = 'hub.example.com'
const ORIGIN = `https://${HOST}`
const OTHER_HOST = 'hub.example.ts.net'
const AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

interface Answer {
  status: number
  headers: IncomingHttpHeaders
  body: string
}

/** A hub behind a proxy on this machine: every request comes from loopback by the proxy's name. */
async function hubOf(key: string | null = KEY) {
  const db = await memoryDatabase()
  const hub = new EventHub()
  const book = await AccessBook.load(db, { revoked: (ids) => hub.closeTagged(ids) })
  const invites = new InviteDesk(db, book, { log: () => {}, waitMs: 50, changed: () => hub.broadcast('devices', { changedAt: Date.now() }) })
  const origins = await PageOrigins.load(db)
  const access = { book, passkeys: new PasskeyDesk(db, book.person), invites, inviteRate: new RateLimit(INVITE_CALLS, 60_000), origins, key: () => key }
  const deps = {
    hub,
    getState: () => ({ fake: true }),
    guard: () => ({ hosts: guardHosts('127.0.0.1', [HOST, OTHER_HOST]), token: key, book, origins }),
    access,
  }
  const server = createEvenKeelServer(deps as unknown as ServerDeps)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const send = (path: string, options: { method?: string; cookie?: string; body?: unknown; host?: string; from?: string; agent?: string } = {}) =>
    new Promise<Answer>((resolve, reject) => {
      const headers: Record<string, string> = { host: options.host ?? HOST, 'user-agent': options.agent ?? AGENT, 'x-forwarded-for': options.from ?? '100.64.0.9' }
      if (options.cookie !== undefined) headers.cookie = options.cookie
      if (options.body !== undefined) Object.assign(headers, { 'content-type': 'application/json', origin: options.host === undefined ? ORIGIN : `https://${options.host}` })
      const req = request({ port, host: '127.0.0.1', path, method: options.method ?? (options.body === undefined ? 'GET' : 'POST'), agent: false, headers }, (res) => {
        let body = ''
        res.setEncoding('utf8').on('data', (chunk) => (body += chunk)).on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }))
      })
      req.on('error', reject).end(options.body === undefined ? undefined : JSON.stringify(options.body))
    })
  return { send, book, origins, port }
}

function cookieOf(answer: Answer): string {
  const line = [answer.headers['set-cookie'] ?? []].flat().find((each) => each.startsWith(`${TOKEN_COOKIE}=`))
  expect(line).toMatch(/HttpOnly; SameSite=Strict/)
  return line!.split(';')[0]!
}

describe('the sign-in through a proxy on this machine', () => {
  it('asks a request by the proxy name to sign in, lets a loopback name through', async () => {
    const { send } = await hubOf()
    expect((await send('/api/state')).status).toBe(401)
    expect(JSON.parse((await send('/api/auth/state')).body)).toEqual({ signedIn: false, keySet: true, passkeyHere: false, device: null })
    expect((await send('/api/state', { host: '127.0.0.1' })).status).toBe(200)
  })

  it('signs in with the owner key: the device cookie lets it in and the device is listed', async () => {
    const { send } = await hubOf()
    expect(JSON.parse((await send('/api/auth/key', { body: { key: 'not-the-key-0123456789' } })).body).notice.code).toBe('auth.wrongKey')
    const cookie = cookieOf(await send('/api/auth/key', { body: { key: KEY } }))
    expect(cookie).not.toContain(KEY)
    expect((await send('/api/state', { cookie })).status).toBe(200)
    const view = JSON.parse((await send('/api/auth/devices', { cookie, body: {} })).body) as DevicesView
    expect(view.devices).toMatchObject([{ device: 'Safari on iPhone', seenFrom: '100.64.0.9', byKey: true }])
    expect(view.current).toBe(view.devices[0]!.id)
  })

  it('adds a passkey after the key and then signs in with it alone', async () => {
    const { send } = await hubOf()
    const cookie = cookieOf(await send('/api/auth/key', { body: { key: KEY } }))
    const authenticator = new FakeAuthenticator()
    const creation = JSON.parse((await send('/api/auth/passkey/register/options', { cookie, body: {} })).body)
    expect(creation.rp.id).toBe(HOST)
    expect((await send('/api/auth/passkey/register', { cookie, body: { response: authenticator.create(creation, ORIGIN) } })).status).toBe(200)
    expect(JSON.parse((await send('/api/auth/state')).body).passkeyHere).toBe(true)
    expect(JSON.parse((await send('/api/auth/state', { host: 'localhost' })).body).passkeyHere).toBe(false)

    const request = JSON.parse((await send('/api/auth/passkey/options', { body: {} })).body)
    const signedIn = await send('/api/auth/passkey', { body: { response: authenticator.get(request, ORIGIN) } })
    expect(signedIn.status).toBe(200)
    const passkeyCookie = cookieOf(signedIn)
    const view = JSON.parse((await send('/api/auth/devices', { cookie: passkeyCookie, body: {} })).body) as DevicesView
    expect(view.passkeys).toMatchObject([{ host: HOST, name: 'Safari on iPhone' }])
    expect(view.devices.map((each) => [each.byKey, each.passkeyHost])).toEqual([
      [true, null],
      [false, HOST],
    ])
  })

  it('refuses the passkey routes that add one before a sign-in', async () => {
    const { send } = await hubOf()
    const answer = await send('/api/auth/passkey/register/options', { body: {} })
    expect(answer.status).toBe(401)
    expect(JSON.parse(answer.body).notice.code).toBe('auth.signInFirst')
  })

  it('closes the event stream of a device signed out, and its cookie no longer lets it in', async () => {
    const { send, book, port } = await hubOf()
    const phone = cookieOf(await send('/api/auth/key', { body: { key: KEY } }))
    const laptop = cookieOf(await send('/api/auth/key', { body: { key: KEY } }))
    const ended = new Promise<string>((resolve, reject) => {
      const req = request({ port, host: '127.0.0.1', path: '/api/events', agent: false, headers: { host: HOST, cookie: phone } }, (res) => {
        let frames = ''
        res.setEncoding('utf8').on('data', (chunk) => {
          frames += chunk
          if (frames.includes('event: state')) void send('/api/auth/devices/revoke-others', { cookie: laptop, body: {} })
        })
        res.on('end', () => resolve(frames))
      })
      req.on('error', reject).end()
    })
    expect(await ended).toContain('event: state')
    expect(book.devices()).toHaveLength(1)
    expect((await send('/api/state', { cookie: phone })).status).toBe(401)
    expect((await send('/api/state', { cookie: laptop })).status).toBe(200)
  })

  it('turns an old link with the key into a device sign-in and drops the key from the address', async () => {
    const { send } = await hubOf()
    const answer = await send(`/settings?tab=page&token=${KEY}`)
    expect(answer.status).toBe(303)
    expect(answer.headers.location).toBe('/settings?tab=page')
    expect((await send('/api/state', { cookie: cookieOf(answer) })).status).toBe(200)
  })

  it('signs out this device', async () => {
    const { send } = await hubOf()
    const cookie = cookieOf(await send('/api/auth/key', { body: { key: KEY } }))
    const out = await send('/api/auth/sign-out', { cookie, body: {} })
    expect([out.headers['set-cookie']].flat()[0]).toMatch(/Max-Age=0/)
    expect((await send('/api/state', { cookie })).status).toBe(401)
  })
})

describe('an invitation of a new device through the routes (BTN-1655)', () => {
  const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36'
  const claimCookieOf = (answer: Answer) => {
    const line = [answer.headers['set-cookie'] ?? []].flat().find((each) => each.startsWith(`${INVITE_COOKIE}=`))
    expect(line).toMatch(/Path=\/api\/auth\/invite\/; HttpOnly; SameSite=Strict/)
    return line!.split(';')[0]!
  }

  it('lets the new device in after "Let in": its claim cookie collects a device token of its own', async () => {
    const { send } = await hubOf()
    const owner = cookieOf(await send('/api/auth/key', { body: { key: KEY } }))
    expect((await send('/api/auth/invites/create', { body: {} })).status).toBe(401)
    const made = JSON.parse((await send('/api/auth/invites/create', { cookie: owner, body: {} })).body) as InviteMade
    const opened = await send('/api/auth/invite/open', { body: { link: made.secret }, agent: ANDROID, from: '100.64.0.12' })
    expect(JSON.parse(opened.body)).toEqual({ state: 'waiting', digits: expect.stringMatching(/^\d\d$/), expiresAt: made.expiresAt })
    const claim = claimCookieOf(opened)
    const view = JSON.parse((await send('/api/auth/devices', { cookie: owner, body: {} })).body) as DevicesView
    expect(view.invites).toMatchObject([{ id: made.id, opened: { device: 'Chrome on Android', from: '100.64.0.12', digits: JSON.parse(opened.body).digits } }])
    expect(JSON.parse((await send('/api/auth/invite/wait', { cookie: claim, body: {} })).body)).toMatchObject({ state: 'waiting' })
    expect((await send('/api/auth/invites/admit', { cookie: owner, body: { id: made.id } })).status).toBe(200)
    // The link alone, with no claim, gets nothing.
    const stranger = await send('/api/auth/invite/wait', { body: {} })
    expect(JSON.parse(stranger.body)).toEqual({ state: 'gone' })
    expect(stranger.headers['set-cookie']).toBeUndefined()
    const admitted = await send('/api/auth/invite/wait', { cookie: claim, body: {} })
    expect(JSON.parse(admitted.body)).toEqual({ state: 'admitted', device: 'Chrome on Android' })
    const device = cookieOf(admitted)
    expect((await send('/api/state', { cookie: device })).status).toBe(200)
    const after = JSON.parse((await send('/api/auth/devices', { cookie: owner, body: {} })).body) as DevicesView
    expect(after.devices.map((each) => [each.device, each.byInvite])).toEqual([
      ['Safari on iPhone', false],
      ['Chrome on Android', true],
    ])
    expect(after.invites).toEqual([])
  })

  it('signs the new device in by its claim again when the answer with its token was lost, until the token is used (BTN-1664)', async () => {
    const { send } = await hubOf()
    const owner = cookieOf(await send('/api/auth/key', { body: { key: KEY } }))
    const made = JSON.parse((await send('/api/auth/invites/create', { cookie: owner, body: {} })).body) as InviteMade
    const claim = claimCookieOf(await send('/api/auth/invite/open', { body: { link: made.secret }, agent: ANDROID, from: '100.64.0.12' }))
    await send('/api/auth/invites/admit', { cookie: owner, body: { id: made.id } })
    const lost = cookieOf(await send('/api/auth/invite/wait', { cookie: claim, body: {} }))
    const again = await send('/api/auth/invite/wait', { cookie: claim, body: {} })
    expect(JSON.parse(again.body)).toEqual({ state: 'admitted', device: 'Chrome on Android' })
    const device = cookieOf(again)
    expect((await send('/api/state', { cookie: lost })).status).toBe(401)
    expect((await send('/api/state', { cookie: device })).status).toBe(200)
    // Presented now: the claim gives nothing more.
    const late = await send('/api/auth/invite/wait', { cookie: claim, body: {} })
    expect(JSON.parse(late.body)).toEqual({ state: 'gone' })
    expect(late.headers['set-cookie']).toBeUndefined()
    const view = JSON.parse((await send('/api/auth/devices', { cookie: owner, body: {} })).body) as DevicesView
    expect(view.devices.map((each) => each.device)).toEqual(['Safari on iPhone', 'Chrome on Android'])
  })

  it('answers a wrong link "gone", as an expired one, and a link another browser opened first "used"', async () => {
    const { send } = await hubOf()
    const owner = cookieOf(await send('/api/auth/key', { body: { key: KEY } }))
    const made = JSON.parse((await send('/api/auth/invites/create', { cookie: owner, body: {} })).body) as InviteMade
    expect(JSON.parse((await send('/api/auth/invite/open', { body: { link: 'no-such-link' } })).body)).toEqual({ state: 'gone' })
    expect(JSON.parse((await send('/api/auth/invite/open', { body: {} })).body)).toEqual({ state: 'gone' })
    await send('/api/auth/invite/open', { body: { link: made.secret } })
    expect(JSON.parse((await send('/api/auth/invite/open', { body: { link: made.secret }, from: '198.51.100.20' })).body)).toEqual({ state: 'used' })
  })

  it('refuses an address past the rate limit of the open routes, and only that address', async () => {
    const { send } = await hubOf()
    for (let count = 0; count < INVITE_CALLS; count++) expect((await send('/api/auth/invite/open', { body: { link: 'guess' }, from: '198.51.100.20' })).status).toBe(200)
    const refused = await send('/api/auth/invite/open', { body: { link: 'guess' }, from: '198.51.100.20' })
    expect(refused.status).toBe(429)
    expect(JSON.parse(refused.body).notice.code).toBe('auth.inviteSlowDown')
    expect((await send('/api/auth/invite/wait', { body: {}, from: '198.51.100.20' })).status).toBe(429)
    expect((await send('/api/auth/invite/open', { body: { link: 'guess' }, from: '198.51.100.21' })).status).toBe(200)
  })
})

describe('a hub without the owner key: the first device let in turns the sign-in on (BTN-1656)', () => {
  const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36'
  const claimOf = (answer: Answer) => [answer.headers['set-cookie'] ?? []].flat().find((each) => each.startsWith(`${INVITE_COOKIE}=`))!.split(';')[0]!

  async function letIn(send: Awaited<ReturnType<typeof hubOf>>['send'], decider?: string) {
    const made = JSON.parse((await send('/api/auth/invites/create', { cookie: decider, body: {} })).body) as InviteMade
    const claim = claimOf(await send('/api/auth/invite/open', { body: { link: made.secret }, agent: ANDROID, from: '100.64.0.12' }))
    const admit = await send('/api/auth/invites/admit', { cookie: decider, body: { id: made.id } })
    expect(admit.status).toBe(200)
    const joined = cookieOf(await send('/api/auth/invite/wait', { cookie: claim, body: {} }))
    return { admit, joined }
  }

  it('asks the proxy name for a sign-in once a device was let in; the browser that let it in is signed in too', async () => {
    const { send, book } = await hubOf(null)
    expect((await send('/api/state')).status).toBe(200)
    const before = JSON.parse((await send('/api/auth/devices', { body: {} })).body) as DevicesView
    expect(before).toMatchObject({ keySet: false, signInOn: false })
    const { admit, joined } = await letIn(send)
    const decider = cookieOf(admit)
    expect((await send('/api/state')).status).toBe(401)
    expect((await send('/api/state', { cookie: decider })).status).toBe(200)
    expect((await send('/api/state', { cookie: joined })).status).toBe(200)
    expect((await send('/api/state', { host: 'localhost' })).status).toBe(200)
    expect(JSON.parse((await send('/api/auth/devices', { cookie: joined, body: {} })).body)).toMatchObject({ keySet: false, signInOn: true })
    expect(book.devices().map((each) => each.device)).toEqual(['Safari on iPhone', 'Chrome on Android'])
  })

  it('stays on when every other device signs out, and turning it off signs every device out and opens the proxy name again', async () => {
    const { send, book } = await hubOf(null)
    const { admit, joined } = await letIn(send)
    expect(JSON.parse((await send('/api/auth/devices/revoke-others', { cookie: joined, body: {} })).body)).toEqual({ revoked: 1 })
    expect((await send('/api/state', { cookie: cookieOf(admit) })).status).toBe(401)
    expect((await send('/api/state')).status).toBe(401)
    const off = await send('/api/auth/sign-in/off', { cookie: joined, body: {} })
    expect(off.status).toBe(200)
    expect(book.devices()).toEqual([])
    expect((await send('/api/state')).status).toBe(200)
  })

  it('a browser on a loopback name lets a device in without getting a token itself', async () => {
    const { send, book } = await hubOf(null)
    const made = JSON.parse((await send('/api/auth/invites/create', { host: 'localhost', body: {} })).body) as InviteMade
    await send('/api/auth/invite/open', { body: { link: made.secret }, agent: ANDROID })
    const admit = await send('/api/auth/invites/admit', { host: 'localhost', body: { id: made.id } })
    expect(admit.headers['set-cookie']).toBeUndefined()
    expect(book.devices()).toEqual([])
    expect((await send('/api/state')).status).toBe(401)
  })

  it('with the key set, the sign-in cannot be turned off', async () => {
    const { send } = await hubOf()
    const owner = cookieOf(await send('/api/auth/key', { body: { key: KEY } }))
    const off = await send('/api/auth/sign-in/off', { cookie: owner, body: {} })
    expect(off.status).toBe(400)
    expect(JSON.parse(off.body).notice.code).toBe('auth.signInKeepsKey')
  })
})

describe('the outside addresses an invitation made by localhost links to (BTN-1661)', () => {
  it('notes the Origin of a request let in by an outside name, never of a loopback name or a request the guard stopped', async () => {
    const { send, origins } = await hubOf()
    await send('/api/auth/key', { body: { key: 'not-the-key-0123456789' } })
    await send('/api/auth/devices', { body: {} })
    expect(origins.list()).toEqual([])
    const cookie = cookieOf(await send('/api/auth/key', { host: OTHER_HOST, body: { key: KEY } }))
    expect(origins.list()).toEqual([])
    await send('/api/auth/devices', { host: OTHER_HOST, cookie, body: {} })
    await send('/api/auth/devices', { host: 'localhost', body: {} })
    await send('/api/auth/devices', { host: '127.0.0.1', body: {} })
    expect(origins.list().map((each) => each.origin)).toEqual([`https://${OTHER_HOST}`])
  })

  it('gives the invitation the addresses, the last one first, and remembers a typed one', async () => {
    const { send, origins } = await hubOf(null)
    origins.seen(ORIGIN)
    await new Promise((resolve) => setTimeout(resolve, 5))
    origins.seen(`https://${OTHER_HOST}`)
    const made = JSON.parse((await send('/api/auth/invites/create', { host: 'localhost', body: {} })).body) as InviteMade
    expect(made.origins.map((each) => each.origin)).toEqual([`https://${OTHER_HOST}`, ORIGIN])

    const typed = await send('/api/auth/invites/origin', { host: 'localhost', body: { origin: 'phone-way.example.net:8443' } })
    expect(JSON.parse(typed.body)).toMatchObject({ origin: 'https://phone-way.example.net:8443', origins: [{ origin: 'https://phone-way.example.net:8443' }, {}, {}] })
    const local = await send('/api/auth/invites/origin', { host: 'localhost', body: { origin: 'http://localhost:4747' } })
    expect([local.status, JSON.parse(local.body).notice.code]).toEqual([400, 'auth.inviteOriginLocal'])
  })
})
