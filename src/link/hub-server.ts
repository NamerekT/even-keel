import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer, type Server } from 'node:https'
import type { HubCertificate } from './cert.js'
import type { HubEnd } from './hub.js'
import {
  CREDENTIALS_PATH, EVENTS_PATH, HOOK_PATH, JOIN_PATH, MCP_PATH, SNAPSHOT_PATH, STREAM_PATH, TALLY_PATH, isAbout, isRefusal,
  type CredentialsPost, type EventsPost, type Frame, type HookPost, type JoinPost, type MachineHello, type McpPost, type Refusal, type SnapshotPost, type TallyPost,
} from './protocol.js'

/** A snapshot names every session of the machine; an events post is `EVENT_BATCH` events at most. */
const MAX_BODY_BYTES = 8 * 1024 * 1024
/** An MCP call carries the files a session attaches, each up to the attachment limit, as base64. */
const MAX_MCP_BYTES = 256 * 1024 * 1024

export interface HubServerOptions {
  hub: HubEnd
  certificate: Pick<HubCertificate, 'cert' | 'key'>
  log: (line: string) => void
  maxBodyBytes?: number
}

/** The status a refusal travels under: the machine reads the body, a person reading a proxy's log reads this. */
const STATUS: Record<Refusal['refused'], number> = { token: 401, version: 426, connection: 409, expired: 410, used: 410 }

class BadRequest extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

async function bodyOf(request: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > limit) throw new BadRequest(413, 'the body is too large')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new BadRequest(400, 'the body is not JSON')
  }
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function helloOf(body: unknown): MachineHello {
  if (!isObject(body) || !isCount(body.api) || typeof body.host !== 'string' || !isCount(body.lastCommand)) throw new BadRequest(400, 'not a handshake')
  if (body.about !== undefined && !isAbout(body.about)) throw new BadRequest(400, 'not a handshake')
  return { api: body.api, host: body.host, lastCommand: body.lastCommand, ...(body.about === undefined ? {} : { about: body.about }) }
}

function joinOf(body: unknown): JoinPost {
  if (!isObject(body) || !isCount(body.api) || !isAbout(body.about)) throw new BadRequest(400, 'not a join of a machine')
  return { api: body.api, about: body.about }
}

function postOf(body: unknown): { connection: string; lastCommand: number } & Record<string, unknown> {
  if (!isObject(body) || typeof body.connection !== 'string' || !isCount(body.lastCommand)) throw new BadRequest(400, 'not a post of a machine')
  return body as { connection: string; lastCommand: number }
}

function eventsOf(body: unknown): EventsPost {
  const post = postOf(body)
  const { events } = post
  const whole = Array.isArray(events) && events.every((event) => isObject(event) && isCount(event.seq) && typeof event.type === 'string' && typeof event.at === 'number')
  if (!whole) throw new BadRequest(400, 'not a post of events')
  return { connection: post.connection, lastCommand: post.lastCommand, events: events as EventsPost['events'] }
}

function mcpOf(body: unknown): McpPost {
  if (!isObject(body) || typeof body.connection !== 'string' || !isObject(body.request)) throw new BadRequest(400, 'not an MCP request of a machine')
  const { path, method, headers, body: text } = body.request
  const strings = isObject(headers) && Object.values(headers).every((value) => typeof value === 'string')
  if (typeof path !== 'string' || !path.startsWith('/') || typeof method !== 'string' || !strings || (text !== undefined && typeof text !== 'string')) {
    throw new BadRequest(400, 'not an MCP request of a machine')
  }
  return { connection: body.connection, request: { path, method, headers: headers as Record<string, string>, ...(text === undefined ? {} : { body: text }) } }
}

function hookOf(body: unknown): HookPost {
  if (!isObject(body) || typeof body.connection !== 'string' || !isObject(body.request)) throw new BadRequest(400, 'not a hook’s request of a machine')
  const { path, method, body: text } = body.request
  if (typeof path !== 'string' || !path.startsWith('/') || typeof method !== 'string' || (text !== undefined && typeof text !== 'string')) {
    throw new BadRequest(400, 'not a hook’s request of a machine')
  }
  return { connection: body.connection, request: { path, method, ...(text === undefined ? {} : { body: text }) } }
}

function credentialsPostOf(body: unknown): CredentialsPost {
  if (!isObject(body) || typeof body.connection !== 'string' || typeof body.project !== 'string' || !Array.isArray(body.urls) || !body.urls.every((url) => typeof url === 'string')) {
    throw new BadRequest(400, 'not a credentials request of a machine')
  }
  return { connection: body.connection, project: body.project, urls: body.urls as string[] }
}

function tallyOf(body: unknown): TallyPost {
  if (!isObject(body) || typeof body.connection !== 'string' || !isObject(body.rows)) throw new BadRequest(400, 'not Tally rows of a machine')
  return { connection: body.connection, rows: body.rows }
}

function answer(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text), 'Cache-Control': 'no-store' })
  response.end(text)
}

const answerOf = (response: ServerResponse, result: object): void => answer(response, isRefusal(result) ? STATUS[result.refused] : 200, result)

/** One frame as a server-sent event, written whole and at once. */
export const frameText = (frame: Frame): string => `event: ${frame.kind}\ndata: ${JSON.stringify(frame)}\n\n`

async function stream(options: HubServerOptions, request: IncomingMessage, response: ServerResponse, limit: number): Promise<void> {
  const hello = helloOf(await bodyOf(request, limit))
  // The hub sends the handshake and the kept commands before it answers the open: they wait here for the headers.
  let waiting: Frame[] | undefined = []
  const opened = await options.hub.open(request.headers.authorization, hello, {
    send: (frame) => {
      if (waiting !== undefined) waiting.push(frame)
      else if (!response.writableEnded) response.write(frameText(frame))
    },
    close: () => void response.end(),
  })
  if (isRefusal(opened)) return answerOf(response, opened)
  response.on('close', () => opened.closed())
  if (response.destroyed) return opened.closed()
  // A proxy must neither keep the stream to itself nor cache it: nginx reads `X-Accel-Buffering` by itself.
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive',
  })
  response.flushHeaders()
  response.socket?.setNoDelay(true)
  for (const frame of waiting) response.write(frameText(frame))
  waiting = undefined
}

/**
 * The hub's HTTPS server for machines, on a port of its own: the stream of a machine's commands and the posts of its
 * events and snapshot. Not listening yet: the caller picks the address.
 */
export function createHubServer(options: HubServerOptions): Server {
  const limit = options.maxBodyBytes ?? MAX_BODY_BYTES
  const mcpLimit = Math.max(limit, MAX_MCP_BYTES)
  return createServer({ cert: options.certificate.cert, key: options.certificate.key }, (request, response) => {
    const path = new URL(request.url ?? '/', 'https://hub').pathname
    const handled = (async () => {
      if (![STREAM_PATH, EVENTS_PATH, SNAPSHOT_PATH, MCP_PATH, HOOK_PATH, TALLY_PATH, CREDENTIALS_PATH, JOIN_PATH].includes(path)) throw new BadRequest(404, 'no such path')
      if (request.method !== 'POST') throw new BadRequest(405, 'POST only')
      if (path === STREAM_PATH) return stream(options, request, response, limit)
      const body = await bodyOf(request, path === MCP_PATH ? mcpLimit : limit)
      const { authorization } = request.headers
      if (path === EVENTS_PATH) return answerOf(response, await options.hub.events(authorization, eventsOf(body)))
      if (path === MCP_PATH) return answerOf(response, await options.hub.mcp(authorization, mcpOf(body)))
      if (path === HOOK_PATH) return answerOf(response, await options.hub.hook(authorization, hookOf(body)))
      if (path === TALLY_PATH) return answerOf(response, await options.hub.tally(authorization, tallyOf(body)))
      if (path === CREDENTIALS_PATH) return answerOf(response, await options.hub.credentials(authorization, credentialsPostOf(body)))
      if (path === JOIN_PATH) return answerOf(response, await options.hub.join(authorization, joinOf(body)))
      const post = postOf(body)
      const snapshot: SnapshotPost = { connection: post.connection, lastCommand: post.lastCommand, snapshot: post.snapshot }
      return answerOf(response, await options.hub.snapshot(authorization, snapshot))
    })()
    handled.catch((error: unknown) => {
      const status = error instanceof BadRequest ? error.status : 500
      if (status === 500) options.log(`link: a machine's request to ${path} failed: ${error instanceof Error ? error.message : String(error)}`)
      if (response.headersSent) response.destroy()
      else answer(response, status, { error: error instanceof BadRequest ? error.message : 'the hub failed' })
    })
  })
}
