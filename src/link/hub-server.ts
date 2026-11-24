import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer, type Server } from 'node:https'
import type { HubCertificate } from './cert.js'
import type { HubEnd } from './hub.js'
import { isNonce } from './join-code.js'
import type { JoinRequests } from './join-requests.js'
import {
  CREDENTIALS_PATH, EVENTS_PATH, GIT_PATH, HOOK_PATH, JOIN_PATH, MAX_BODY_BYTES, MCP_PATH, REQUEST_ANSWER_PATH, REQUEST_PATH, SKILLS_PATH, SNAPSHOT_PATH, STREAM_PATH, TALLY_PATH, isAbout, isRefusal, megabytes,
  type CredentialsPost, type EventsPost, type GitPost, type Frame, type HookPost, type JoinPost, type MachineHello, type McpPost, type Refusal, type RequestAnswerPost, type RequestPost, type SkillsPost,
  type SnapshotPost, type TallyPost,
} from './protocol.js'

/** An MCP call carries the files a session attaches, each up to the attachment limit, as base64. */
const MAX_MCP_BYTES = 256 * 1024 * 1024

export interface HubServerOptions {
  hub: HubEnd
  certificate: Pick<HubCertificate, 'cert' | 'key'>
  log: (line: string) => void
  maxBodyBytes?: number
  /** The machines asking to join by the address (BTN-1620); none — the door takes only connection strings. */
  requests?: Pick<JoinRequests, 'ask' | 'answer'>
}

/** The status a refusal travels under: the machine reads the body, a person reading a proxy's log reads this. */
const STATUS: Record<Refusal['refused'], number> = { token: 401, version: 426, connection: 409, expired: 410, used: 410, busy: 429, full: 429, declined: 403 }

/** A request asks with no sign-in: a small body is all it may carry. */
const REQUEST_BODY_BYTES = 64 * 1024

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

function requestOf(body: unknown): RequestPost {
  if (!isObject(body) || !isCount(body.api) || !isAbout(body.about) || !isNonce(body.nonce) || typeof body.public !== 'boolean') throw new BadRequest(400, 'not a request to join')
  return { api: body.api, about: body.about, nonce: body.nonce, public: body.public }
}

function requestAnswerOf(body: unknown): RequestAnswerPost {
  if (!isObject(body) || typeof body.request !== 'string' || !isNonce(body.nonce)) throw new BadRequest(400, 'not a request to join')
  return { request: body.request, nonce: body.nonce }
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

function skillsPostOf(body: unknown): SkillsPost {
  if (!isObject(body) || typeof body.connection !== 'string' || typeof body.install !== 'string') throw new BadRequest(400, 'not a skills request of a machine')
  return { connection: body.connection, install: body.install }
}

function gitPostOf(body: unknown): GitPost {
  if (!isObject(body) || typeof body.connection !== 'string' || typeof body.project !== 'string' || !isObject(body.request)) throw new BadRequest(400, 'not a git request of a machine')
  const { method, path, query } = body.request
  const optional = ['contentType', 'contentEncoding', 'gitProtocol', 'body'].every((key) => body.request === undefined || (body.request as Record<string, unknown>)[key] === undefined || typeof (body.request as Record<string, unknown>)[key] === 'string')
  if (typeof method !== 'string' || typeof path !== 'string' || typeof query !== 'string' || !optional) throw new BadRequest(400, 'not a git request of a machine')
  return { connection: body.connection, project: body.project, request: body.request as unknown as GitPost['request'] }
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
      const asking = path === REQUEST_PATH || path === REQUEST_ANSWER_PATH
      const known = [STREAM_PATH, EVENTS_PATH, SNAPSHOT_PATH, MCP_PATH, HOOK_PATH, TALLY_PATH, CREDENTIALS_PATH, SKILLS_PATH, GIT_PATH, JOIN_PATH].includes(path)
      if (!known && !(asking && options.requests !== undefined)) throw new BadRequest(404, 'no such path')
      if (request.method !== 'POST') throw new BadRequest(405, 'POST only')
      if (path === STREAM_PATH) return stream(options, request, response, limit)
      if (asking) {
        const asked = await bodyOf(request, REQUEST_BODY_BYTES)
        if (path === REQUEST_ANSWER_PATH) return answerOf(response, options.requests!.answer(requestAnswerOf(asked)))
        return answerOf(response, await options.requests!.ask(request.socket.remoteAddress ?? '', requestOf(asked)))
      }
      const body = await bodyOf(request, path === MCP_PATH ? mcpLimit : limit)
      const { authorization } = request.headers
      if (path === EVENTS_PATH) return answerOf(response, await options.hub.events(authorization, eventsOf(body)))
      if (path === MCP_PATH) return answerOf(response, await options.hub.mcp(authorization, mcpOf(body)))
      if (path === HOOK_PATH) return answerOf(response, await options.hub.hook(authorization, hookOf(body)))
      if (path === TALLY_PATH) return answerOf(response, await options.hub.tally(authorization, tallyOf(body)))
      if (path === CREDENTIALS_PATH) return answerOf(response, await options.hub.credentials(authorization, credentialsPostOf(body)))
      if (path === SKILLS_PATH) return answerOf(response, await options.hub.skills(authorization, skillsPostOf(body)))
      if (path === GIT_PATH) return answerOf(response, await options.hub.git(authorization, gitPostOf(body)))
      if (path === JOIN_PATH) return answerOf(response, await options.hub.join(authorization, joinOf(body)))
      const post = postOf(body)
      const snapshot: SnapshotPost = { connection: post.connection, lastCommand: post.lastCommand, snapshot: post.snapshot }
      return answerOf(response, await options.hub.snapshot(authorization, snapshot))
    })()
    handled.catch((error: unknown) => {
      const status = error instanceof BadRequest ? error.status : 500
      if (status === 500) options.log(`link: a machine's request to ${path} failed: ${error instanceof Error ? error.message : String(error)}`)
      if (status === 413) {
        const declared = Number(request.headers['content-length'])
        const size = Number.isFinite(declared) ? megabytes(declared) : 'an unknown size'
        const sizeLimit = megabytes(path === MCP_PATH ? mcpLimit : limit)
        options.log(`link: a machine's post to ${path} of ${size} was refused: over the limit of ${sizeLimit}; the machine's log names its largest parts`)
      }
      if (response.headersSent) response.destroy()
      else answer(response, status, { error: error instanceof BadRequest ? error.message : 'the hub failed' })
    })
  })
}
