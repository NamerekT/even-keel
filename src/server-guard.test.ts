import { request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { guardHosts, TOKEN_COOKIE } from './guard.js'
import { guardedServer } from './server-guard.js'
import { oauthCallback, type ProfilesControl } from './profiles/routes.js'

const TOKEN = 'fake-token-0123456789abcdef'
const CALLBACK = '/api/profiles/oauth/callback'
const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
  vi.restoreAllMocks()
})

async function fixture() {
  const finish = vi.fn(async () => {})
  const handle = vi.fn<Parameters<typeof guardedServer>[1]>(async (req, res) => {
    const url = new URL(req.url!, 'http://localhost')
    if (url.pathname === CALLBACK) return oauthCallback({ oauth: { finish } } as unknown as ProfilesControl, url.searchParams, res)
    res.writeHead(200, { 'content-type': 'application/json' }).end('{}')
  })
  const server = guardedServer(() => ({ hosts: guardHosts('127.0.0.1', []), token: TOKEN }), handle)
  server.prependListener('request', req => Object.defineProperties(req.socket, {
    remoteAddress: { value: '192.0.2.10', configurable: true },
    localAddress: { value: '192.0.2.20', configurable: true },
  }))
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const send = (path: string, method = 'GET', headers: Record<string, string> = {}) => new Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = request({ port, host: '127.0.0.1', path, method, agent: false, headers }, res => {
      let body = ''
      res.setEncoding('utf8').on('data', chunk => { body += chunk }).on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }))
    })
    req.on('error', reject).end()
  })
  return { send, handle, finish }
}

describe('guarded OAuth callback', () => {
  it('issues a scoped Lax cookie on an authenticated start, including an existing Strict login', async () => {
    const { send } = await fixture()
    for (const headers of [{ cookie: `${TOKEN_COOKIE}=${TOKEN}` }, { authorization: `Bearer ${TOKEN}` }]) {
      const started = await send('/api/profiles/oauth/start', 'POST', headers)
      expect(started.status).toBe(200)
      const cookie = started.headers['set-cookie']?.[0]
      expect(cookie).toMatch(/^even-keel-oauth=\d+\.[\w-]+; Path=\/api\/profiles\/oauth\/callback; HttpOnly; SameSite=Lax; Max-Age=600$/)
      expect(cookie).not.toContain(TOKEN)
      expect((await send(`${CALLBACK}?state=state&code=code`, 'GET', { cookie: cookie!.split(';')[0]! })).status).toBe(200)
      expect(started.headers['cache-control']).toBe('no-store')
    }
  })

  it('does not issue the callback cookie on other requests or refusals', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { send, handle } = await fixture()
    const refused = await send('/api/profiles/oauth/start', 'POST')
    expect(refused.status).toBe(401)
    expect(refused.headers['set-cookie']).toBeUndefined()
    expect(handle).not.toHaveBeenCalled()
    for (const [method, path] of [['GET', '/api/profiles/oauth/start'], ['POST', '/api/profiles/check']]) {
      expect((await send(path!, method, { cookie: `${TOKEN_COOKIE}=${TOKEN}` })).headers['set-cookie']).toBeUndefined()
    }
  })

  it.each([{}, { host: 'evil.example.net' }, { origin: 'https://evil.example.net' }])('scrubs a refused callback without invoking OAuth (%j)', async headers => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { send, finish, handle } = await fixture()
    const refused = await send(`${CALLBACK}?code=private-code&state=private-state&error_description=private-description`, 'GET', headers)
    expect([401, 403]).toContain(refused.status)
    expect(finish).not.toHaveBeenCalled()
    expect(handle).not.toHaveBeenCalled()
    expect(refused.headers['cache-control']).toBe('no-store')
    expect(refused.headers['referrer-policy']).toBe('no-referrer')
    expect(refused.body).toContain("history.replaceState(null, '', '/settings#trackers')")
    expect(refused.body).toContain('location.reload()')
    expect(refused.body).not.toContain('private-')
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private-')
  })

  it('scrubs the successful and failed OAuth responses with a same-origin navigation', async () => {
    const { send, finish } = await fixture()
    for (const fails of [false, true]) {
      if (fails) finish.mockRejectedValueOnce(new Error('private-reason'))
      const response = await send(`${CALLBACK}?state=state&code=private-code`, 'GET', { cookie: `${TOKEN_COOKIE}=${TOKEN}` })
      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toContain('text/html')
      expect(response.headers['referrer-policy']).toBe('no-referrer')
      expect(response.body).toContain('location.reload()')
      expect(response.body).not.toContain('private-')
    }
    expect(finish).toHaveBeenCalledTimes(2)
  })
})
