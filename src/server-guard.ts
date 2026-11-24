import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { deviceNameOf } from './access/device-name.js'
import { keyMarkOf } from './access/store.js'
import { addressOf, deviceCookie, guard, isOAuthCallback, oauthCallbackCookie, tokenForm, type GuardSettings, type Visitor } from './guard.js'
import { oauthCallbackPage } from './profiles/oauth-response.js'
import { securePage } from './server-security.js'

const MAX_REPORTED = 100

export type GuardedHandler = (request: IncomingMessage, response: ServerResponse, visitor: Visitor) => Promise<void>

export function guardedServer(settings: () => GuardSettings, handle: GuardedHandler): Server {
  const reported = new Set<string>()
  return createServer((request, response) => {
    response.setHeader('x-content-type-options', 'nosniff')
    const current = settings()
    const callback = isOAuthCallback({ method: request.method ?? 'GET', url: request.url ?? '/' })
    const socket = { remote: request.socket.remoteAddress, local: request.socket.localAddress }
    const verdict = guard(current, {
      method: request.method ?? 'GET',
      url: request.url ?? '/',
      host: request.headers.host,
      origin: request.headers.origin,
      contentType: request.headers['content-type'],
      cookie: request.headers.cookie,
      authorization: request.headers.authorization,
      ...socket,
    })
    const forwarded = request.headers['x-forwarded-for']
    const address = addressOf(socket, Array.isArray(forwarded) ? forwarded[0] : forwarded)
    if (verdict.kind === 'enter') {
      response.writeHead(303, { location: verdict.location, 'set-cookie': verdict.cookie, 'cache-control': 'no-store' }).end()
      return
    }
    if (verdict.kind === 'signIn') {
      // An old link with the key in `?token=`: the device gets its own token and the address loses the key.
      const book = current.book!
      const key = current.token!
      book.signIn({ device: deviceNameOf(request.headers['user-agent']), address, keyMark: keyMarkOf(key) }).then(
        ({ secret }) => response.writeHead(303, { location: verdict.location, 'set-cookie': deviceCookie(secret), 'cache-control': 'no-store' }).end(),
        (error: unknown) => response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end(String(error)),
      )
      return
    }
    if (verdict.kind === 'refuse') {
      securePage(response)
      // One line per distinct refusal: a rebinding page may retry endlessly.
      if (!reported.has(verdict.reason) && reported.size < MAX_REPORTED) {
        reported.add(verdict.reason)
        console.warn(`guard: refused ${request.method} ${request.url?.split('?')[0]}: ${verdict.reason}`)
      }
      if (callback) {
        oauthCallbackPage(response, verdict.status)
        return
      }
      // With a book a browser never lands here: it gets the page, whose sign-in screen asks.
      if (verdict.status === 401 && current.book === undefined && current.token !== null && request.method === 'GET' && !(request.url ?? '/').startsWith('/api/')) {
        response.writeHead(401, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(tokenForm(current.language))
        return
      }
      response.writeHead(verdict.status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }).end(verdict.reason)
      return
    }
    const device = verdict.kind === 'pass' ? verdict.device : undefined
    if (device !== undefined) current.book?.seen(device, address)
    const asks = current.token !== null || current.book?.signInOn() === true
    if (verdict.kind === 'pass' && asks && request.method === 'POST' && request.url?.split('?')[0] === '/api/profiles/oauth/start') {
      response.setHeader('set-cookie', oauthCallbackCookie(current.token))
      response.setHeader('cache-control', 'no-store')
    }
    handle(request, response, { signedIn: verdict.kind === 'pass', device, address }).catch((error: unknown) => {
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      response.end(String(error))
    })
  })
}
