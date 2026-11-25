import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { hookRouteOf } from '../link/hooks.js'
import type { HookAnswer, HookRequest } from '../link/protocol.js'

/** A hook's body is a tool call's input at most; the hub's page takes 64 KiB of it. */
const MAX_BODY_BYTES = 1024 * 1024
const LOOPBACK = '127.0.0.1'

export interface HookReceiverOptions {
  /** The hub's answer over the link; `undefined` — the hub is not reachable now. */
  forward(request: HookRequest): Promise<HookAnswer | undefined>
  /** The machine's accounts panel: the settings guard of its account folders asks `/api/state` for it. */
  account(): unknown
  /**
   * The inbox socket a session's hook reports at its start (BTN-1322), kept on this machine, where the socket is: the
   * token never goes over the link. `false` — refused, or the machine is not up yet.
   */
  inbox?(sessionId: string, socket: string, token: string): boolean
  /**
   * This machine knows no inbox for the session (BTN-1506): the hub's answer to its mail hook asks for it, or stops
   * asking, by this and not by the hub's own inboxes.
   */
  inboxWanted?(sessionId: string): boolean
  log(line: string): void
}

const INBOX_ROUTE = /^\/api\/sessions\/([^/]+)\/inbox$/
const MAIL_ROUTE = /^\/api\/sessions\/([^/]+)\/mail$/

/**
 * Where the hooks of a machine's sessions ask Even Keel on a machine with no page (BTN-1260, `docs/machines/link.md`,
 * "Hooks through the hub"): on loopback, at the page's port when it is free, it carries a route of the hooks to the
 * hub's page over the link and answers 503 at once while the hub is away. `/api/state` is answered here with the
 * machine's own accounts only.
 */
export class HookReceiver {
  private server: Server | undefined
  private bound: { host: string; port: number } | undefined

  constructor(private readonly options: HookReceiverOptions) {}

  /** The address the sessions are given as `EVEN_KEEL_URL`. */
  get address(): { host: string; port: number } {
    if (this.bound === undefined) throw new Error('the hooks receiver does not listen yet')
    return this.bound
  }

  /** Listens on `port` of loopback, or on a free one when another process holds it. */
  async start(port: number): Promise<{ host: string; port: number }> {
    try {
      this.bound = await this.listen(port)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error
      this.bound = await this.listen(0)
      this.options.log(`machine: port ${port} is taken; the sessions' hooks ask Even Keel on port ${this.bound.port}`)
    }
    return this.bound
  }

  async close(): Promise<void> {
    const server = this.server
    this.server = undefined
    if (server !== undefined) await new Promise((resolve) => server.close(resolve))
  }

  private listen(port: number): Promise<{ host: string; port: number }> {
    const server = createServer((request, response) => {
      this.answer(request, response).catch((error: unknown) => {
        this.options.log(`machine: a hook's request failed: ${error instanceof Error ? error.message : String(error)}`)
        if (!response.headersSent) response.writeHead(500).end()
        else response.destroy()
      })
    })
    return new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, LOOPBACK, () => {
        server.off('error', reject)
        this.server = server
        resolve({ host: LOOPBACK, port: (server.address() as AddressInfo).port })
      })
    })
  }

  private async answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? 'GET'
    const path = request.url ?? '/'
    // A hook is no browser: a page of another site that reaches loopback is turned away.
    if (request.headers.origin !== undefined || !isLoopbackHost(request.headers.host)) return void response.writeHead(403).end()
    if (method === 'GET' && path.split('?')[0] === '/api/state') return json(response, 200, JSON.stringify({ account: this.options.account() }))
    const inbox = method === 'POST' ? INBOX_ROUTE.exec(path.split('?')[0]!) : null
    if (inbox !== null) return this.inbox(request, response, inbox[1]!)
    const route = hookRouteOf(method, path)
    if (route === undefined) return void response.writeHead(404).end()
    const body = await bodyOf(request)
    if (body === null) return void response.writeHead(413).end()
    const answer = await this.options.forward({ method, path: route.path, ...(method === 'POST' ? { body } : {}) })
    if (answer === undefined) return json(response, 503, JSON.stringify({ error: 'the hub is not reachable' }))
    if (answer.body === '') return void response.writeHead(answer.status).end()
    json(response, answer.status, this.withInbox(route.path, answer))
  }

  private withInbox(path: string, answer: HookAnswer): string {
    const mail = answer.status === 200 ? MAIL_ROUTE.exec(path.split('?')[0]!) : null
    if (mail === null) return answer.body
    let body: Record<string, unknown>
    try {
      body = JSON.parse(answer.body) as Record<string, unknown>
    } catch {
      return answer.body
    }
    const { inbox: _hub, ...rest } = body
    return JSON.stringify(this.options.inboxWanted?.(decodeURIComponent(mail[1]!)) === true ? { ...rest, inbox: true } : rest)
  }

  private async inbox(request: IncomingMessage, response: ServerResponse, encoded: string): Promise<void> {
    if (this.options.inbox === undefined) return void response.writeHead(404).end()
    const body = await bodyOf(request)
    let fields: { socket?: unknown; token?: unknown }
    let sessionId: string
    try {
      fields = JSON.parse(body ?? '') as { socket?: unknown; token?: unknown }
      sessionId = decodeURIComponent(encoded)
    } catch {
      return void response.writeHead(400).end()
    }
    const { socket, token } = fields ?? {}
    const known = typeof socket === 'string' && typeof token === 'string' && this.options.inbox(sessionId, socket, token)
    response.writeHead(known ? 204 : 400).end()
  }
}

function json(response: ServerResponse, status: number, text: string): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(text)
}

function isLoopbackHost(host: string | undefined): boolean {
  const name = (host ?? '').replace(/:\d+$/, '')
  return name === LOOPBACK || name === 'localhost' || name === '[::1]'
}

/** `null` — over `MAX_BODY_BYTES`. */
async function bodyOf(request: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) return null
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}
