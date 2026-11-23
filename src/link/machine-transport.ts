import { request, type IncomingMessage } from 'node:http'
import { connect, type TLSSocket } from 'node:tls'
import { partsOf } from './body-size.js'
import { fingerprintOf } from './cert.js'
import type { HubTransport, StreamSink } from './machine.js'
import {
  API_VERSION, CREDENTIALS_PATH, EVENTS_PATH, HOOK_PATH, JOIN_PATH, MAX_BODY_BYTES, MCP_PATH, SNAPSHOT_PATH, STREAM_PATH, TALLY_PATH, TooLarge, bearerOf, isRefusal,
  type ConnectionToken, type CredentialsAnswer, type EventsAnswer, type Frame, type HookAnswer, type JoinAnswer, type MachineAbout, type McpAnswer, type Refusal, type TallyAnswer,
} from './protocol.js'

export interface TransportOptions {
  log: (line: string) => void
  /** How long a connection attempt and a post may take. */
  timeoutMs?: number
}

const TIMEOUT_MS = 15_000
/** An MCP call waits as long as the gateway waits for a server of its own. */
const MCP_TIMEOUT_MS = 10 * 60_000
/** A hook gives up on Even Keel in 2 s (5 s for its mail and note): the connection and the answer each fit in it. */
export const HOOK_TIMEOUT_MS = 1_800
/** A post of Tally rows is up to 2 MB the hub writes into its database before it answers. */
const TALLY_TIMEOUT_MS = 2 * 60_000

/**
 * A TLS connection to the token's hub, checked before a byte is written to it, so the secret goes to no other server.
 * With a fingerprint in the token the certificate must be exactly that one and its chain and name are not looked at
 * (it is self-signed); without one the certificate is verified as any HTTPS one.
 */
export function connectPinned(token: Pick<ConnectionToken, 'hub' | 'fingerprint'>, timeoutMs: number = TIMEOUT_MS): Promise<TLSSocket> {
  const url = new URL(token.hub)
  const pinned = token.fingerprint !== ''
  return new Promise((resolve, reject) => {
    const socket = connect({ host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 443), rejectUnauthorized: !pinned, ALPNProtocols: ['http/1.1'] })
    const failed = (error: Error) => {
      socket.destroy()
      reject(error)
    }
    socket.setTimeout(timeoutMs, () => failed(new Error(`no connection to ${url.host} in ${timeoutMs} ms`)))
    socket.once('error', failed)
    socket.once('secureConnect', () => {
      const raw = socket.getPeerCertificate().raw as Buffer | undefined
      if (pinned && (raw === undefined || fingerprintOf(raw) !== token.fingerprint)) {
        return failed(new Error(`the certificate of ${url.host} is not the one of this machine's connection token`))
      }
      socket.setTimeout(0)
      socket.removeListener('error', failed)
      resolve(socket)
    })
  })
}

function textOf(response: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    response.on('data', (chunk: Buffer) => chunks.push(chunk))
    response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    response.on('error', reject)
  })
}

const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/** The frames of a server-sent stream as they come: text is fed in pieces, an event ends at an empty line. */
export function frameReader(frame: (frame: Frame) => void): (chunk: string) => void {
  let rest = ''
  return (chunk) => {
    rest += chunk.replace(/\r\n/g, '\n')
    for (let end = rest.indexOf('\n\n'); end !== -1; end = rest.indexOf('\n\n')) {
      const data = rest.slice(0, end).split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
      rest = rest.slice(end + 2)
      const value = data === '' ? undefined : parsed(data)
      if (typeof value === 'object' && value !== null && typeof (value as { kind?: unknown }).kind === 'string') frame(value as Frame)
    }
  }
}

/** A POST of JSON to the token's hub over a socket already checked, under the token's `Authorization`. */
function sendTo(token: ConnectionToken, socket: TLSSocket, path: string, body: unknown, text = JSON.stringify(body)) {
  const url = new URL(token.hub)
  const sent = request({
    createConnection: () => socket,
    method: 'POST',
    path: `${url.pathname.replace(/\/+$/, '')}${path}`,
    headers: {
      Host: url.host,
      Authorization: bearerOf(token),
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(text),
      Accept: path === STREAM_PATH ? 'text/event-stream' : 'application/json',
    },
  })
  sent.end(text)
  return sent
}

/**
 * One post on a connection of its own: the hub's answer when `whole` takes it, its refusal, or a throw — `TooLarge`
 * for a body over the hub's limit, not sent at all (the hub would cut the connection mid-body), or one it answered 413.
 */
async function postTo<T>(token: ConnectionToken, path: string, body: unknown, whole: (value: object) => boolean, timeoutMs: number, answerMs = timeoutMs): Promise<T | Refusal> {
  const text = JSON.stringify(body)
  const bytes = Buffer.byteLength(text)
  if (path !== MCP_PATH && bytes > MAX_BODY_BYTES) throw new TooLarge(path, bytes, partsOf(body))
  const socket = await connectPinned(token, timeoutMs)
  try {
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const sent = sendTo(token, socket, path, body, text)
      sent.setTimeout(answerMs, () => sent.destroy(new Error(`no answer from the hub in ${answerMs} ms`)))
      sent.once('response', resolve)
      sent.once('error', reject)
    })
    const value = parsed(await textOf(response))
    if (isRefusal(value)) return value
    if (response.statusCode === 200 && typeof value === 'object' && value !== null && whole(value)) return value as T
    if (response.statusCode === 413) throw new TooLarge(path, bytes, partsOf(body))
    throw new Error(`the hub answered ${response.statusCode} to ${path}`)
  } finally {
    socket.destroy()
  }
}

/**
 * Exchanges a connection string for the machine's own token (BTN-1242): the same hub, certificate and id with the
 * secret the hub gave back. A throw — the hub was not reached or answered something else.
 */
export async function joinHub(token: ConnectionToken, about: MachineAbout, timeoutMs: number = TIMEOUT_MS): Promise<ConnectionToken | Refusal> {
  const answer = await postTo<JoinAnswer>(token, JOIN_PATH, { api: API_VERSION, about }, (value) => typeof (value as JoinAnswer).secret === 'string', timeoutMs)
  return isRefusal(answer) ? answer : { ...token, secret: answer.secret }
}

/** The link over HTTPS: the stream is one long answer to a POST, each post a request of its own. */
export function httpsTransport(token: ConnectionToken, options: TransportOptions): HubTransport {
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS
  const send = (socket: TLSSocket, path: string, body: unknown) => sendTo(token, socket, path, body)
  const post = <T>(path: string, body: unknown, whole: (value: object) => boolean, answerMs = timeoutMs): Promise<T | Refusal> =>
    postTo<T>(token, path, body, whole, timeoutMs, answerMs)
  const counted = (value: object): boolean => typeof (value as EventsAnswer).lastEvent === 'number'
  const answered = (value: object): boolean => {
    const { status, headers, body } = value as Partial<McpAnswer>
    return typeof status === 'number' && typeof headers === 'object' && headers !== null && typeof body === 'string'
  }

  return {
    open(hello, sink: StreamSink) {
      let socket: TLSSocket | undefined
      let over = false
      const end = (refusal?: Refusal) => {
        if (over) return
        over = true
        socket?.destroy()
        sink.closed(refusal)
      }
      connectPinned(token, timeoutMs).then((connected) => {
        if (over) return void connected.destroy()
        socket = connected
        sink.opened()
        const sent = send(connected, STREAM_PATH, hello)
        sent.once('error', () => end())
        sent.once('response', (response) => {
          if (response.statusCode !== 200) {
            textOf(response).then((text) => {
              const value = parsed(text)
              if (!isRefusal(value)) options.log(`link: the hub answered ${response.statusCode} to the stream`)
              end(isRefusal(value) ? value : undefined)
            }, () => end())
            return
          }
          const read = frameReader((frame) => { if (!over) sink.frame(frame) })
          response.setEncoding('utf8')
          response.on('data', read)
          response.once('end', () => end())
          response.once('close', () => end())
          response.once('error', () => end())
        })
      }, (error: unknown) => {
        if (!over) options.log(`link: ${error instanceof Error ? error.message : String(error)}`)
        end()
      })
      return {
        close: () => {
          over = true
          socket?.destroy()
        },
      }
    },
    events: (body) => post<EventsAnswer>(EVENTS_PATH, body, counted),
    snapshot: (body) => post<EventsAnswer>(SNAPSHOT_PATH, body, counted),
    mcp: (body) => post<McpAnswer>(MCP_PATH, body, answered, MCP_TIMEOUT_MS),
    tally: (body) => post<TallyAnswer>(TALLY_PATH, body, (value) => typeof (value as TallyAnswer).taken === 'boolean', TALLY_TIMEOUT_MS),
    credentials: (body) => post<CredentialsAnswer>(CREDENTIALS_PATH, body, (value) => Array.isArray((value as CredentialsAnswer).credentials)),
    hook: (body) => {
      const limit = Math.min(timeoutMs, HOOK_TIMEOUT_MS)
      return postTo<HookAnswer>(token, HOOK_PATH, body, (value) => typeof (value as HookAnswer).status === 'number' && typeof (value as HookAnswer).body === 'string', limit, limit)
    },
  }
}
