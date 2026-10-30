import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { Readable } from 'node:stream'
import { fail } from '../notice/notice.js'
import { deletesRecord } from '../sessions/protection.js'
import { parseRoute } from './launch.js'
import type { ServerEntry } from './model.js'

const IDLE_MS = 30 * 60_000
const READY_TIMEOUT_MS = 60_000
const READY_POLL_MS = 200
const READY_TRY_MS = 1_000
const REQUEST_TIMEOUT_MS = 10 * 60_000
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost'])
const FORWARD = ['accept', 'content-type', 'mcp-session-id', 'mcp-protocol-version', 'last-event-id']
const BACK = ['content-type', 'mcp-session-id']

/** A stdio server that can serve HTTP itself: one process for every session, on a port and token of the gateway's. */
interface HttpMode {
  env: (port: number, token: string) => Record<string, string>
  path: string
}

/** By npm package; verified in the package's own sources. */
const HTTP_MODES: Record<string, HttpMode> = {
  '@firfi/huly-mcp': {
    env: (port, token) => ({ MCP_TRANSPORT: 'http', MCP_HTTP_HOST: '127.0.0.1', MCP_HTTP_PORT: String(port), MCP_AUTH_TOKEN: token }),
    path: '/mcp',
  },
}

/** What a route leads to: the server's entry with the project's settings and the pool's keys put in. */
export interface GatewayTarget {
  entry: ServerEntry
  /** The npm package a pinned stdio server runs. */
  npm: string | null
  /** Variables a stdio server gets on top of its entry's `env`. */
  env: Record<string, string>
  oauth?: GatewayOAuth
  /** The tracker whose deletes Protection refuses on this server (BTN-541): such a `tools/call` never reaches it. */
  refuseDeletes?: string
}

export interface GatewayOAuth {
  token(rejected?: string): Promise<string>
  refused(token: string): Promise<void>
}

/** OAuth replaces only Authorization; other headers and their required keys still apply. */
export function withoutAuthorization(entry: ServerEntry): ServerEntry {
  return { ...entry, headers: Object.fromEntries(Object.entries(stringsOf(entry.headers)).filter(([name]) => name.toLowerCase() !== 'authorization')) }
}

export interface GatewayDeps {
  resolve: (route: { project: string; name: string; install: string; server: string }) => GatewayTarget | null
  /** The environment of a server process before its own variables: the service's, without the credentials. */
  baseEnv: () => NodeJS.ProcessEnv
  log: (line: string) => void
}

/** Why a request is refused before its route is looked at, or `null`: the gateway has no token, a browser must not reach it. */
export function refusal(method: string, headers: IncomingMessage['headers']): number | null {
  const host = headers.host
  if (host === undefined || !LOCAL_HOSTS.has(hostnameOf(host))) return 403
  if (headers.origin !== undefined) return 403
  if (method === 'POST' && !/^application\/json\b/i.test(headers['content-type'] ?? '')) return 415
  return null
}

function hostnameOf(host: string): string {
  try {
    return new URL(`http://${host}`).hostname
  } catch {
    return ''
  }
}

/**
 * Even Keel's MCP gateway on 127.0.0.1: sessions reach every server of their packages here, with no key of their own.
 * A remote HTTP server is proxied with its headers, a stdio one with an HTTP mode runs once for all sessions, any
 * other stdio one gets a process per MCP session.
 */
export class McpGateway {
  private server: Server | undefined
  private port = 0
  private readonly shared = new Map<string, SharedServer>()
  private readonly bridges = new Map<string, Bridge>()
  /** The last error of each route's server, logged once until it changes or the server answers again (BTN-589). */
  private readonly failing = new Map<string, string>()

  constructor(private readonly deps: GatewayDeps) {}

  get origin(): string {
    return `http://127.0.0.1:${this.port}`
  }

  async listen(port: number): Promise<void> {
    const server = createServer((req, res) => void this.handle(req, res))
    await new Promise<void>((resolve, reject) => {
      server.once('error', (error) => reject(fail('packages.port', { port }, {}, { cause: error })))
      server.listen(port, '127.0.0.1', () => resolve())
    })
    this.server = server
    const address = server.address()
    this.port = typeof address === 'object' && address !== null ? address.port : port
  }

  async close(): Promise<void> {
    for (const each of this.shared.values()) each.child.kill()
    for (const each of this.bridges.values()) each.close()
    this.shared.clear()
    this.bridges.clear()
    await new Promise<void>((resolve) => (this.server === undefined ? resolve() : this.server.close(() => resolve())))
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const refused = refusal(req.method ?? 'GET', req.headers)
    if (refused !== null) return void res.writeHead(refused).end()
    const route = parseRoute(new URL(req.url ?? '/', 'http://127.0.0.1').pathname)
    const target = route === null ? null : this.deps.resolve(route)
    if (route === null || target === null) return void res.writeHead(404).end()
    const label = `${route.name}/${route.server}`
    const key = `${route.project}\u0000${label}`
    const started = Date.now()
    let body: Buffer | undefined
    let local = false
    try {
      if (req.method === 'POST') body = await readBody(req)
      const refused = target.refuseDeletes === undefined ? null : refusedDeletes(body, target.refuseDeletes)
      if (refused !== null) {
        this.deps.log(`mcp gateway: ${label}: Protection refused ${refused.tools.join(', ')}`)
        return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(refused.reply))
      }
      const { entry } = target
      if (typeof entry.url === 'string') await proxy(req, res, entry.url, stringsOf(entry.headers), body, target.oauth)
      else if (typeof entry.command !== 'string') return void res.writeHead(404).end()
      else {
        local = true
        const mode = target.npm === null ? undefined : HTTP_MODES[target.npm]
        if (mode !== undefined) {
          const shared = await this.sharedFor(`${route.name}@${route.install}/${route.server}`, target, mode, label)
          await proxy(req, res, `http://127.0.0.1:${shared.port}${mode.path}`, { authorization: `Bearer ${shared.token}` }, body)
        } else await this.bridge(req, res, target, label, body)
      }
      if (this.failing.delete(key)) this.deps.log(`mcp gateway: ${label} works again`)
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        // The client gave up waiting, the process is still there: a cold `npx` start can take a minute.
        const seconds = Math.round((Date.now() - started) / 1000)
        const methods = methodsOf(body) ?? req.method
        this.deps.log(`mcp gateway: ${label} did not answer ${methods} in ${seconds} s${local && methods === 'initialize' ? ', still starting' : ''}`)
      } else {
        const message = (error as Error).message
        if (this.failing.get(key) !== message) this.deps.log(`mcp gateway: ${label}: ${message}`)
        this.failing.set(key, message)
      }
      if (!res.headersSent) res.writeHead(502)
      res.end()
    }
  }

  /** One process per server and its settings: another value of a setting is another process. */
  private async sharedFor(id: string, target: GatewayTarget, mode: HttpMode, label: string): Promise<SharedServer> {
    const key = `${id}\u0000${JSON.stringify(target.entry)}\u0000${JSON.stringify(target.env)}`
    const known = this.shared.get(key)
    if (known !== undefined) {
      known.touch()
      return known.ready
    }
    const port = await freePort()
    const token = randomBytes(24).toString('hex')
    const started = Date.now()
    const child = this.spawn(target, mode.env(port, token), label)
    const entry = new SharedServer(child, port, token, mode.path, () => {
      if (this.shared.get(key) === entry) this.shared.delete(key)
    })
    this.shared.set(key, entry)
    entry.ready.then(
      () => this.deps.log(`mcp gateway: ${label} started in ${Math.round((Date.now() - started) / 1000)} s`),
      () => {},
    )
    return entry.ready
  }

  private spawn(target: GatewayTarget, extra: Record<string, string>, label: string): ChildProcess {
    const { entry } = target
    const command = entry.command as string
    const node = command === 'node'
    const shell = process.platform === 'win32' && !node && !/\.exe$/i.test(command)
    const args = Array.isArray(entry.args) ? entry.args.map(String) : []
    const child = spawn(node ? process.execPath : shell ? shellQuoted(command) : command, shell ? args.map(shellQuoted) : args, {
      env: { ...this.deps.baseEnv(), ...stringsOf(entry.env), ...target.env, ...extra },
      cwd: typeof entry.cwd === 'string' ? entry.cwd : undefined,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell,
    })
    let tail = ''
    child.stderr?.on('data', (chunk: Buffer) => (tail = (tail + chunk.toString()).slice(-2000)))
    child.on('error', (error) => this.deps.log(`mcp gateway: ${label}: ${error.message}`))
    child.on('exit', (code, signal) => signal === null && this.deps.log(`mcp gateway: ${label} exited with ${code}${tail.trim() === '' ? '' : `: ${tail.trim().split('\n').at(-1)}`}`))
    return child
  }

  private async bridge(req: IncomingMessage, res: ServerResponse, target: GatewayTarget, label: string, raw: Buffer | undefined): Promise<void> {
    const id = req.headers['mcp-session-id']
    const known = typeof id === 'string' ? this.bridges.get(id) : undefined
    if (req.method === 'DELETE') {
      known?.close()
      return void res.writeHead(known === undefined ? 404 : 200).end()
    }
    if (req.method === 'GET') {
      if (known === undefined) return void res.writeHead(typeof id === 'string' ? 404 : 405).end()
      return known.stream(res)
    }
    if (req.method !== 'POST') return void res.writeHead(405).end()
    let body: unknown
    try {
      body = JSON.parse((raw ?? Buffer.alloc(0)).toString('utf8'))
    } catch {
      return void res.writeHead(400).end()
    }
    const messages = (Array.isArray(body) ? body : [body]) as Record<string, unknown>[]
    let bridge = known
    if (bridge === undefined) {
      if (typeof id === 'string' || !messages.some((each) => each?.method === 'initialize')) return void res.writeHead(typeof id === 'string' ? 404 : 400).end()
      const session = randomUUID()
      bridge = new Bridge(this.spawn(target, {}, label), () => this.bridges.delete(session))
      this.bridges.set(session, bridge)
      res.setHeader('mcp-session-id', session)
    }
    const replies = await bridge.send(messages)
    if (replies.length === 0) return void res.writeHead(202).end()
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(Array.isArray(body) ? replies : replies[0]))
  }
}

class SharedServer {
  readonly ready: Promise<SharedServer>
  private timer: NodeJS.Timeout | undefined

  constructor(
    readonly child: ChildProcess,
    readonly port: number,
    readonly token: string,
    path: string,
    gone: () => void,
  ) {
    let exited = false
    const end = () => {
      exited = true
      clearTimeout(this.timer)
      gone()
    }
    child.on('exit', end)
    child.on('error', end)
    this.ready = waitForAnswer(port, path, () => exited).then(
      () => this,
      (error: unknown) => {
        child.kill()
        throw error
      },
    )
    this.touch()
  }

  touch(): void {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.child.kill(), IDLE_MS).unref()
  }
}

/** A stdio server for one MCP session: JSON lines to and from its process, its replies matched to requests by id. */
class Bridge {
  private buffer = ''
  private readonly waiting = new Map<string, (reply: unknown) => void>()
  private readonly streams = new Set<ServerResponse>()
  private timer: NodeJS.Timeout | undefined
  private closed = false

  constructor(
    private readonly child: ChildProcess,
    private readonly gone: () => void,
  ) {
    child.stdout?.on('data', (chunk: Buffer) => this.read(chunk.toString('utf8')))
    child.on('exit', () => this.close())
    child.on('error', () => this.close())
    child.stdin?.on('error', () => this.close())
    this.touch()
  }

  async send(messages: Record<string, unknown>[]): Promise<unknown[]> {
    if (this.closed) throw new Error('the server exited')
    this.touch()
    const replies = messages
      .filter((each) => typeof each?.method === 'string' && each.id !== undefined && each.id !== null)
      .map(
        (each) =>
          new Promise<unknown>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`no reply to ${String(each.method)}`)), REQUEST_TIMEOUT_MS)
            this.waiting.set(JSON.stringify(each.id), (reply) => {
              clearTimeout(timer)
              if (reply === undefined) reject(new Error('the server exited'))
              else resolve(reply)
            })
          }),
      )
    for (const each of messages) this.child.stdin?.write(`${JSON.stringify(each)}\n`)
    return Promise.all(replies)
  }

  /** Messages of the server that answer no request go to the session's GET stream. */
  stream(res: ServerResponse): void {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    res.flushHeaders()
    this.streams.add(res)
    res.on('close', () => this.streams.delete(res))
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    clearTimeout(this.timer)
    this.child.kill()
    for (const reply of this.waiting.values()) reply(undefined)
    this.waiting.clear()
    for (const each of this.streams) each.end()
    this.gone()
  }

  private read(text: string): void {
    this.buffer += text
    let end: number
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end).trim()
      this.buffer = this.buffer.slice(end + 1)
      if (line === '') continue
      let message: Record<string, unknown>
      try {
        message = JSON.parse(line) as Record<string, unknown>
      } catch {
        continue
      }
      const key = message.method === undefined && message.id !== undefined ? JSON.stringify(message.id) : undefined
      const reply = key === undefined ? undefined : this.waiting.get(key)
      if (reply !== undefined) {
        this.waiting.delete(key!)
        reply(message)
      } else for (const each of this.streams) each.write(`event: message\ndata: ${line}\n\n`)
    }
  }

  private touch(): void {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.close(), IDLE_MS).unref()
  }
}

async function proxy(req: IncomingMessage, res: ServerResponse, url: string, headers: Record<string, string>, body: Buffer | undefined, oauth?: GatewayOAuth): Promise<void> {
  const forward: Record<string, string> = {}
  for (const name of FORWARD) {
    const value = req.headers[name]
    if (typeof value === 'string') forward[name] = value
  }
  const abort = new AbortController()
  res.on('close', () => abort.abort())
  // The client may have left while a shared server was still coming up.
  if (req.socket.destroyed) abort.abort()
  const send = (authorization?: string) => fetch(url, {
    method: req.method,
    headers: { ...forward, ...(oauth ? stringsOf(withoutAuthorization({ headers }).headers) : headers), ...(authorization === undefined ? {} : { authorization: `Bearer ${authorization}` }) },
    body: body === undefined ? undefined : new Uint8Array(body),
    signal: abort.signal,
    redirect: 'error',
  })
  let token = await oauth?.token()
  let response = await send(token)
  if (oauth && response.status === 401) {
    await response.body?.cancel()
    token = await oauth.token(token)
    response = await send(token)
    if (response.status === 401) await oauth.refused(token)
  }
  const back: Record<string, string> = {}
  for (const name of BACK) {
    const value = response.headers.get(name)
    if (value !== null) back[name] = value
  }
  res.writeHead(response.status, back)
  if (response.body === null) return void res.end()
  Readable.fromWeb(response.body as import('node:stream/web').ReadableStream).on('error', () => res.end()).pipe(res)
}

/**
 * The answer to a body that calls a deleting tool, `null` when it calls none. Each such call gets a tool error the agent
 * reads; in a batch the other requests are not sent either and get a JSON-RPC error, so nothing of it half-runs.
 */
export function refusedDeletes(body: Buffer | undefined, tracker: string): { tools: string[]; reply: unknown } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(body?.toString('utf8') ?? '')
  } catch {
    return null
  }
  const messages = (Array.isArray(parsed) ? parsed : [parsed]) as (Record<string, unknown> | null)[]
  const refusedOf = (message: Record<string, unknown> | null): string | null => {
    if (message?.method !== 'tools/call' || typeof message.params !== 'object' || message.params === null) return null
    const { name, arguments: args } = message.params as { name?: unknown; arguments?: unknown }
    return typeof name === 'string' && deletesRecord(name, args) ? name : null
  }
  const tools = messages.map(refusedOf).filter((tool) => tool !== null)
  if (tools.length === 0) return null
  const text = `Even Keel's Protection refuses deleting ${tracker} records in chain sessions. Do not try another way: ask the user to delete it or to turn this tracker off in Protection.`
  const replies = messages
    .filter((message) => message !== null && message.id !== undefined && message.id !== null)
    .map((message) => refusedOf(message) !== null
      ? { jsonrpc: '2.0', id: message!.id, result: { content: [{ type: 'text', text }], isError: true } }
      : { jsonrpc: '2.0', id: message!.id, error: { code: -32600, message: 'Not sent: the batch also called a tool Protection refuses' } })
  return { tools, reply: Array.isArray(parsed) ? replies : replies[0] }
}

/** The JSON-RPC methods of a request body, joined by a comma; `null` when it has none. */
function methodsOf(body: Buffer | undefined): string | null {
  try {
    const parsed: unknown = JSON.parse(body?.toString('utf8') ?? '')
    const methods = (Array.isArray(parsed) ? parsed : [parsed]).map((each) => (each as Record<string, unknown> | null)?.method).filter((each) => typeof each === 'string')
    return methods.length === 0 ? null : methods.join(', ')
  } catch {
    return null
  }
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/**
 * An argument for `cmd.exe /s /c`: Node joins a shell command's arguments with spaces, so a path with a space
 * (`…\Claude Extensions\…`) would fall apart. Quoted the way the program's own parser reads it back.
 */
export function shellQuoted(arg: string): string {
  if (arg !== '' && !/[\s"&|<>^()]/.test(arg)) return arg
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`
}

function stringsOf(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}

/**
 * Until the server answers HTTP at all, whatever the status: a port that accepts is not enough. huly-mcp listens
 * before it attaches its handler, and a request that comes in between is never answered.
 */
async function waitForAnswer(port: number, path: string, exited: () => boolean): Promise<void> {
  const until = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < until) {
    if (exited()) throw new Error('the server exited before it answered')
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(READY_TRY_MS) })
      await response.body?.cancel()
      return
    } catch (error) {
      if ((error as Error).name !== 'TimeoutError') await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS))
    }
  }
  throw new Error(`the server did not answer on ${port} in ${READY_TIMEOUT_MS / 1000} s`)
}
