import { request, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { FakeAuthenticator } from './access/authenticator.fixture.js'
import { AccessBook } from './access/book.js'
import { PasskeyDesk } from './access/passkeys.js'
import type { DevicesView } from './access/view.js'
import { EventHub } from './events.js'
import { guardHosts, TOKEN_COOKIE } from './guard.js'
import { createEvenKeelServer, type ServerDeps } from './server.js'
import { memoryDatabase } from './storage/memory.js'

const KEY = 'owner-key-0123456789abcdef'
const HOST = 'hub.example.com'
const ORIGIN = `https://${HOST}`
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
async function hubOf() {
  const db = await memoryDatabase()
  const hub = new EventHub()
  const book = await AccessBook.load(db, { revoked: (ids) => hub.closeTagged(ids) })
  const access = { book, passkeys: new PasskeyDesk(db, book.person), key: () => KEY }
  const deps = {
    hub,
    getState: () => ({ fake: true }),
    guard: () => ({ hosts: guardHosts('127.0.0.1', [HOST]), token: KEY, book }),
    access,
  }
  const server = createEvenKeelServer(deps as unknown as ServerDeps)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const send = (path: string, options: { method?: string; cookie?: string; body?: unknown; host?: string } = {}) =>
    new Promise<Answer>((resolve, reject) => {
      const headers: Record<string, string> = { host: options.host ?? HOST, 'user-agent': AGENT, 'x-forwarded-for': '100.64.0.9' }
      if (options.cookie !== undefined) headers.cookie = options.cookie
      if (options.body !== undefined) Object.assign(headers, { 'content-type': 'application/json', origin: ORIGIN })
      const req = request({ port, host: '127.0.0.1', path, method: options.method ?? (options.body === undefined ? 'GET' : 'POST'), agent: false, headers }, (res) => {
        let body = ''
        res.setEncoding('utf8').on('data', (chunk) => (body += chunk)).on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }))
      })
      req.on('error', reject).end(options.body === undefined ? undefined : JSON.stringify(options.body))
    })
  return { send, book, port }
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
    expect(JSON.parse((await send('/api/auth/state')).body)).toEqual({ signedIn: false, keySet: true, device: null })
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

    const request = JSON.parse((await send('/api/auth/passkey/options', { body: {} })).body)
    const signedIn = await send('/api/auth/passkey', { body: { response: authenticator.get(request, ORIGIN) } })
    expect(signedIn.status).toBe(200)
    const passkeyCookie = cookieOf(signedIn)
    const view = JSON.parse((await send('/api/auth/devices', { cookie: passkeyCookie, body: {} })).body) as DevicesView
    expect(view.passkeys).toMatchObject([{ host: HOST, name: 'Safari on iPhone' }])
    expect(view.devices.map((each) => each.byKey)).toEqual([true, false])
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
