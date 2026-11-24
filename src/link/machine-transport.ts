import { request, type IncomingMessage } from 'node:http'
import { connect, type TLSSocket } from 'node:tls'
import { partsOf } from './body-size.js'
import { fingerprintOf } from './cert.js'
import { joinCodeOf, newNonce } from './join-code.js'
import type { HubTransport, StreamSink } from './machine.js'
import {
  API_VERSION, CREDENTIALS_PATH, EVENTS_PATH, GIT_PATH, HOOK_PATH, JOIN_PATH, MAX_BODY_BYTES, MCP_PATH, REQUEST_ANSWER_PATH, REQUEST_PATH, SKILLS_PATH, SNAPSHOT_PATH, STREAM_PATH, TALLY_PATH, TooLarge,
  bearerOf, isRefusal,
  type ConnectionToken, type CredentialsAnswer, type EventsAnswer, type Frame, type GitAnswer, type HookAnswer, type JoinAnswer, type MachineAbout, type McpAnswer, type Refusal, type RequestAnswer,
  type RequestState, type SkillsAnswer, type TallyAnswer,
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
/** The answer to a skills request carries every file of the user's skills. */
const SKILLS_TIMEOUT_MS = 2 * 60_000

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
      // A request to join is made before the machine is anyone (BTN-1620).
      ...(token.machine !== '' && { Authorization: bearerOf(token) }),
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
      // Rejected before the destroy: over TLS the request's own error would be only "socket hang up" (BTN-1634).
      sent.setTimeout(answerMs, () => {
        const error = new Error(`no answer from the hub in ${answerMs} ms`)
        reject(error)
        sent.destroy(error)
      })
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

/**
 * The certificate a hub's address shows (BTN-1620): `public` — it verified as one of a public authority for that
 * name, and the fingerprint is empty, as in a string issued behind such a proxy; else the SHA-256 of what came.
 */
export function seeHub(hub: string, timeoutMs: number = TIMEOUT_MS): Promise<{ fingerprint: string; public: boolean }> {
  const url = new URL(hub)
  return new Promise((resolve, reject) => {
    const socket = connect({ host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 443), rejectUnauthorized: false, ALPNProtocols: ['http/1.1'] })
    const over = (error?: Error) => {
      socket.destroy()
      if (error !== undefined) reject(error)
    }
    socket.setTimeout(timeoutMs, () => over(new Error(`no connection to ${url.host} in ${timeoutMs} ms`)))
    socket.once('error', over)
    socket.once('secureConnect', () => {
      const raw = socket.getPeerCertificate().raw as Buffer | undefined
      const authorized = socket.authorized
      over()
      if (authorized) return resolve({ fingerprint: '', public: true })
      if (raw === undefined) return reject(new Error(`${url.host} showed no certificate`))
      resolve({ fingerprint: fingerprintOf(raw), public: false })
    })
  })
}

export interface AskOptions {
  /** The code to compare on the hub's page, once the hub took the request. */
  shown(code: string, expiresAt: number): void
  pollMs?: number
  timeoutMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const POLL_MS = 2_000
/** How long the machine goes on asking through failed posts past the request's time before it gives up. */
const ASK_GRACE_MS = 30_000

/**
 * Asks the hub at the address to let this machine in (BTN-1620) and waits for a person on its page: the answer is a
 * connection string's token to exchange with `joinHub`, pinned to the certificate first seen, or the hub's refusal.
 * Every post after the first goes only to that certificate, so the answer comes from the hub the code was made with.
 */
export async function askToJoin(hub: string, about: MachineAbout, options: AskOptions): Promise<ConnectionToken | Refusal> {
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const seen = await seeHub(hub, timeoutMs)
  const nonce = newNonce()
  const code = await joinCodeOf(seen.fingerprint, nonce)
  const pinned: ConnectionToken = { hub, fingerprint: seen.fingerprint, machine: '', secret: '' }
  const asked = await postTo<RequestAnswer>(pinned, REQUEST_PATH, { api: API_VERSION, about, nonce, public: seen.public }, (value) => typeof (value as RequestAnswer).request === 'string', timeoutMs)
  if (isRefusal(asked)) return asked
  options.shown(code, asked.expiresAt)
  const isState = (value: object): boolean => (value as { state?: unknown }).state === 'waiting' || (value as { state?: unknown }).state === 'admitted'
  for (;;) {
    await sleep(options.pollMs ?? POLL_MS)
    let state: RequestState | Refusal
    try {
      state = await postTo<RequestState>(pinned, REQUEST_ANSWER_PATH, { request: asked.request, nonce }, isState, timeoutMs)
    } catch (error) {
      if (now() > asked.expiresAt + ASK_GRACE_MS) throw error
      continue
    }
    if (isRefusal(state)) return state
    if (state.state === 'admitted') return { hub, fingerprint: seen.fingerprint, machine: state.machine, secret: state.secret }
  }
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
    skills: (body) => post<SkillsAnswer>(SKILLS_PATH, body, (value) => {
      const { skills } = value as Partial<SkillsAnswer>
      return skills === null || (typeof skills === 'object' && skills !== undefined && Array.isArray(skills.files))
    }, SKILLS_TIMEOUT_MS),
    git: (body) => post<GitAnswer>(GIT_PATH, body, (value) => typeof (value as GitAnswer).status === 'number' && typeof (value as GitAnswer).body === 'string'),
    hook: (body) => {
      const limit = Math.min(timeoutMs, HOOK_TIMEOUT_MS)
      return postTo<HookAnswer>(token, HOOK_PATH, body, (value) => typeof (value as HookAnswer).status === 'number' && typeof (value as HookAnswer).body === 'string', limit, limit)
    },
  }
}
