import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { guard, tokenForm, type GuardSettings } from './guard.js'

const MAX_REPORTED = 100

export function guardedServer(settings: () => GuardSettings, handle: (request: IncomingMessage, response: ServerResponse) => Promise<void>): Server {
  const reported = new Set<string>()
  return createServer((request, response) => {
    const current = settings()
    const verdict = guard(current, {
      method: request.method ?? 'GET',
      url: request.url ?? '/',
      host: request.headers.host,
      origin: request.headers.origin,
      cookie: request.headers.cookie,
      authorization: request.headers.authorization,
      remote: request.socket.remoteAddress,
      local: request.socket.localAddress,
    })
    if (verdict.kind === 'enter') {
      response.writeHead(303, { location: verdict.location, 'set-cookie': verdict.cookie, 'cache-control': 'no-store' }).end()
      return
    }
    if (verdict.kind === 'refuse') {
      // One line per distinct refusal: a rebinding page may retry endlessly.
      if (!reported.has(verdict.reason) && reported.size < MAX_REPORTED) {
        reported.add(verdict.reason)
        console.warn(`guard: refused ${request.method} ${request.url?.split('?')[0]}: ${verdict.reason}`)
      }
      if (verdict.status === 401 && current.token !== null && request.method === 'GET' && !(request.url ?? '/').startsWith('/api/')) {
        response.writeHead(401, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(tokenForm(current.language))
        return
      }
      response.writeHead(verdict.status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }).end(verdict.reason)
      return
    }
    handle(request, response).catch((error: unknown) => {
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      response.end(String(error))
    })
  })
}
