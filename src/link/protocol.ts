/**
 * The hub ↔ machine link (BTN-988, `docs/machines.md`): what goes over it, apart from how it is carried. The machine
 * opens the connection: the hub's commands come down one stream as frames, the machine's events go up as posts.
 */

/** The version both ends name in the handshake; another one is refused before anything else is said. */
export const API_VERSION = 5

/** The pulse of both directions; two missed ones break the connection. */
export const HEARTBEAT_MS = 20_000
export const MISSED_PULSES = 2

/** The pauses before a reconnect: 1, 2, 4 … 30 s. */
export const RECONNECT_FIRST_MS = 1_000
export const RECONNECT_MAX_MS = 30_000

/** The paths of the hub's server for machines, under the address of the connection token. */
export const STREAM_PATH = '/link/stream'
export const EVENTS_PATH = '/link/events'
export const SNAPSHOT_PATH = '/link/snapshot'
export const MCP_PATH = '/link/mcp'

/** How many events one post carries. */
export const EVENT_BATCH = 100

/** A hub's order to a machine. `project` and `folder` name what it touches: the machine runs it only for those it agreed to. */
export interface Command {
  type: string
  project?: string
  folder?: string
  payload?: unknown
}

export interface NumberedCommand extends Command {
  seq: number
}

/** What a machine tells its hub. Numbered by the machine, kept by it until the hub confirms the number. */
export interface MachineEvent {
  seq: number
  type: string
  at: number
  payload?: unknown
}

/** The machine's first words on a stream. */
export interface MachineHello {
  api: number
  /** The host's name, for the page. */
  host: string
  /** The highest command number the machine has taken: the hub sends what follows it. */
  lastCommand: number
}

export interface HubHello {
  api: number
  /** This connection's name: the posts of an older one are refused. */
  connection: string
  heartbeatMs: number
  /** The highest event number the hub has taken: the machine sends what follows it. */
  lastEvent: number
}

export type Frame = { kind: 'hello'; hello: HubHello } | { kind: 'ping' } | { kind: 'command'; command: NumberedCommand }

/** Why a hub turned a machine away: its token is unknown or revoked, the API versions differ, or the post came over a connection that is no longer the machine's. */
export type Refusal = { refused: 'token' } | { refused: 'version'; api: number } | { refused: 'connection' }

export interface EventsPost {
  connection: string
  events: MachineEvent[]
  /** The highest command number taken: the hub forgets the commands up to it. */
  lastCommand: number
}

export interface EventsAnswer {
  /** The highest event number the hub has taken. */
  lastEvent: number
}

export interface SnapshotPost {
  connection: string
  snapshot: unknown
  lastCommand: number
}

/**
 * A session's request to an MCP server that runs in the hub (BTN-990), carried by the machine's gateway: the path
 * under the hub's gateway, the method, the MCP headers and the body as text.
 */
export interface McpRequest {
  path: string
  method: string
  headers: Record<string, string>
  body?: string
}

/** The hub's answer to it, whole: a stream the server opens is not carried. */
export interface McpAnswer {
  status: number
  headers: Record<string, string>
  body: string
}

/** Not an event and not numbered: it waits for its answer, and a lost one is the session's to repeat. */
export interface McpPost {
  connection: string
  request: McpRequest
}

/** The events a machine writes about the link itself. */
export const REFUSED_EVENT = 'command.refused'
export const FAILED_EVENT = 'command.failed'
export const INTERRUPTED_EVENT = 'command.interrupted'

export const isRefusal = (value: unknown): value is Refusal =>
  typeof value === 'object' && value !== null && typeof (value as { refused?: unknown }).refused === 'string'

/**
 * What a machine is given to connect: the hub's address for machines, the SHA-256 of its certificate, the machine's
 * id and its secret. The machine pins the certificate, so the secret goes only to its hub and a command comes only
 * from it; the hub keeps a hash of the secret and can revoke it. An empty fingerprint is a hub behind a certificate
 * of a public authority (a reverse proxy that ends TLS): the machine then verifies it as any HTTPS one.
 */
export interface ConnectionToken {
  hub: string
  fingerprint: string
  machine: string
  secret: string
}

const TOKEN_PREFIX = 'ekm1.'

export function encodeToken(token: ConnectionToken): string {
  const { hub, fingerprint, machine, secret } = token
  return TOKEN_PREFIX + Buffer.from(JSON.stringify({ hub, fingerprint, machine, secret }), 'utf8').toString('base64url')
}

/** `undefined` — not a connection token. */
export function parseToken(text: string): ConnectionToken | undefined {
  const trimmed = text.trim()
  if (!trimmed.startsWith(TOKEN_PREFIX)) return undefined
  try {
    const raw: unknown = JSON.parse(Buffer.from(trimmed.slice(TOKEN_PREFIX.length), 'base64url').toString('utf8'))
    if (typeof raw !== 'object' || raw === null) return undefined
    const { hub, fingerprint, machine, secret } = raw as Record<string, unknown>
    if (typeof hub !== 'string' || typeof fingerprint !== 'string' || typeof machine !== 'string' || typeof secret !== 'string') return undefined
    if (!/^https:\/\//.test(hub) || !/^([0-9a-f]{64})?$/.test(fingerprint) || machine === '' || secret === '') return undefined
    return { hub, fingerprint, machine, secret }
  } catch {
    return undefined
  }
}

/** The `Authorization` value of a machine's requests. */
export const bearerOf = (token: Pick<ConnectionToken, 'machine' | 'secret'>): string => `Bearer ${token.machine}.${token.secret}`

/** The machine's id and secret of an `Authorization` header; `undefined` — none there. */
export function credentialsOf(header: string | undefined): { machine: string; secret: string } | undefined {
  const match = /^Bearer ([^.\s]+)\.([^\s]+)$/.exec(header ?? '')
  return match === null ? undefined : { machine: match[1]!, secret: match[2]! }
}
