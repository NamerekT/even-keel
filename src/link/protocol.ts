/**
 * The hub ↔ machine link (BTN-988, `docs/machines.md`): what goes over it, apart from how it is carried. The machine
 * opens the connection: the hub's commands come down one stream as frames, the machine's events go up as posts.
 */
import type { GitCredential } from '../git/credentials.js'
import type { SkillsCopy } from '../packages/skills.js'
import type { MachineAbout } from './view.js'

/** The version both ends name in the handshake; another one is refused before anything else is said. */
export const API_VERSION = 22

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
export const HOOK_PATH = '/link/hook'
export const TALLY_PATH = '/link/tally'
export const CREDENTIALS_PATH = '/link/credentials'
export const SKILLS_PATH = '/link/skills'
export const GIT_PATH = '/link/git'
/** The one post of a connection string: it is exchanged for the machine's own secret (BTN-1242). */
export const JOIN_PATH = '/link/join'
/** A machine asks to join by the hub's address alone (BTN-1620), and asks again for the answer of a person on the page. */
export const REQUEST_PATH = '/link/request'
export const REQUEST_ANSWER_PATH = '/link/request/answer'

/** How long a connection string can be joined with. */
export const INVITE_MS = 30 * 60_000
/** How long a machine's request to join waits for a person on the hub's page. */
export const REQUEST_MS = 10 * 60_000

/** The link's own command: the hub names a project's folder on the machine, which agrees to it inside its root. */
export const ASSIGN_COMMAND = 'projects.assign'

/** The payload of `projects.assign`: the machine whose mark in the folder the hub's user chose to take over. */
export interface AssignPayload {
  takeOver?: string
}

/**
 * The machine's answer to an assignment of a folder another machine's mark holds (`docs/machines.md`, "The folder's
 * mark"): the project, the folder and the machine the mark names. No consent is given.
 */
export const TAKEN_EVENT = 'projects.taken'

export interface FolderTaken {
  project: string
  folder: string
  machine: string
  name: string
}

/** How many events one post carries; fewer when they are over `MAX_BODY_BYTES` together. */
export const EVENT_BATCH = 100

/**
 * The largest body of a machine's post, MCP calls aside: a snapshot names the sessions the hub asks about
 * (`factsScope`), an events post is `EVENT_BATCH` events at most. The machine does not send a larger one (`TooLarge`).
 */
export const MAX_BODY_BYTES = 8 * 1024 * 1024

/** A post over `MAX_BODY_BYTES`, not sent: `parts` names its largest parts with their sizes, for the log. */
export class TooLarge extends Error {
  constructor(readonly path: string, readonly bytes: number, readonly parts: string) {
    super(`a post of ${megabytes(bytes)} to ${path} is over the hub's limit of ${megabytes(MAX_BODY_BYTES)}`)
  }
}

export const megabytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`

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

export type { MachineAbout }

/** The machine's first words on a stream. */
export interface MachineHello {
  api: number
  /** The host's name, for the page. */
  host: string
  /** The highest command number the machine has taken: the hub sends what follows it. */
  lastCommand: number
  /** What the machine is now; the hub's own machine leaves it out. */
  about?: MachineAbout
}

/** A connection string exchanged for the machine's secret: under the string's own `Authorization`. */
export interface JoinPost {
  api: number
  about: MachineAbout
}

/** The machine's own secret: it replaces the string's, which works no more. */
export interface JoinAnswer {
  secret: string
}

/**
 * A machine asks to join with no string (BTN-1620): its report and its number, of which with the certificate it saw
 * it shows the code; `public` — the certificate verified as one of a public authority, so the code is of the number.
 */
export interface RequestPost {
  api: number
  about: MachineAbout
  nonce: string
  public: boolean
}

export interface RequestAnswer {
  request: string
  expiresAt: number
}

/** The machine asks what became of its request, by its number again: no one else learns the answer. */
export interface RequestAnswerPost {
  request: string
  nonce: string
}

/** Still waiting, or let in: a secret to join with once, as a connection string's, for the machine to exchange. */
export type RequestState = { state: 'waiting' } | { state: 'admitted'; machine: string; secret: string }

export interface HubHello {
  api: number
  /** This connection's name: the posts of an older one are refused. */
  connection: string
  heartbeatMs: number
  /** The highest event number the hub has taken: the machine sends what follows it. */
  lastEvent: number
}

export type Frame = { kind: 'hello'; hello: HubHello } | { kind: 'ping' } | { kind: 'command'; command: NumberedCommand }

/**
 * Why a hub turned a machine away: its token is unknown or revoked, the API versions differ, or the post came over a
 * connection that is no longer the machine's. A connection string is also `expired` past its time and `used` once a
 * machine joined with it. A request to join (BTN-1620) is `busy` while another from the same address waits, `full`
 * while as many as the hub keeps wait, `declined` by a person and `expired` past its time or after the hub restarted.
 */
export type Refusal =
  | { refused: 'token' } | VersionRefusal | { refused: 'connection' } | { refused: 'expired' } | { refused: 'used' }
  | { refused: 'busy' } | { refused: 'full' } | { refused: 'declined' }

/**
 * Another API version: `api` is the hub's, `evenKeel` its version of Even Keel, the one to install on the machine
 * (BTN-994; a hub before it sent `api` alone, so a machine reads it as optional), `commit` the commit of the checkout
 * the hub runs from (BTN-1275; none for a package of npm), the one a machine from a checkout moves to. The body never
 * changes in a later API version: a machine of any version must read it to catch up.
 */
export interface VersionRefusal {
  refused: 'version'
  api: number
  evenKeel?: string
  commit?: string
}

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

/**
 * A session's hook asking Even Keel's page (BTN-1260), carried from the machine's receiver to the hub's page: one of
 * the routes of `hookRouteOf` (`./hooks.ts`), its path with the query and the body as text.
 */
export interface HookRequest {
  method: string
  path: string
  body?: string
}

/** The page's answer: its status and its JSON body as text. */
export interface HookAnswer {
  status: number
  body: string
}

/** Not an event and not numbered, as `McpPost`: a lost answer is the hook's to go without. */
export interface HookPost {
  connection: string
  request: HookRequest
}

/**
 * Rows of a machine's own Tally collector (BTN-1280, `docs/tally.md`, "Machines elsewhere"): not an event, so a hub
 * whose stats are off or not open yet never holds the machine's events back. The number and the receipt are the
 * machine's read mark, moved only on `taken`; the rows are written by their keys, so a post sent again changes nothing.
 */
export interface TallyPost {
  connection: string
  rows: unknown
}

/** `taken: false` — the hub keeps no stats now: the machine keeps its marks and sends the rows again later. */
export interface TallyAnswer {
  taken: boolean
}

/**
 * The machine's git is about to reach the HTTPS remotes `urls` of a project's folder (BTN-1541): the hub answers with
 * the token of each remote's profile, for that one call. Not an event, never kept: a lost answer is a call with what
 * git has of its own.
 */
export interface CredentialsPost {
  connection: string
  project: string
  urls: string[]
}

/** Only for a project in the machine's pool; a remote with no profile is left out. */
export interface CredentialsAnswer {
  credentials: GitCredential[]
}

/**
 * A machine elsewhere installs the hub's install `install` of the user's skills package (BTN-1565): its marketplace is
 * the hub's `state/skills/`, which the machine lacks, so it asks the hub for the skills that install holds.
 */
export interface SkillsPost {
  connection: string
  install: string
}

/** `null` — the hub holds no files of that install. */
export interface SkillsAnswer {
  skills: SkillsCopy | null
}

/**
 * One request of git's smart HTTP protocol to the memory repository of a project (BTN-1648, `docs/sessions/memory.md`):
 * the machine's git reaches the hub's `<id>.git` through the machine's relay. `path` is what follows the repository in
 * the address (`/info/refs`, `/git-upload-pack`, `/git-receive-pack`), the body base64.
 */
export interface GitRequest {
  method: string
  path: string
  query: string
  contentType?: string
  contentEncoding?: string
  gitProtocol?: string
  body?: string
}

/** Not an event and not numbered, as `McpPost`: a lost answer is a sync that tries again. */
export interface GitPost {
  connection: string
  project: string
  request: GitRequest
}

/** git's answer as the hub's `git http-backend` gave it, the body base64; 403 — a project outside the machine's pool. */
export interface GitAnswer {
  status: number
  contentType: string
  body: string
}

/** The events a machine writes about the link itself. */
export const REFUSED_EVENT = 'command.refused'
export const FAILED_EVENT = 'command.failed'
export const INTERRUPTED_EVENT = 'command.interrupted'

/** A machine's report as it came over the wire: every field of its type. */
export function isAbout(value: unknown): value is MachineAbout {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const about = value as Record<string, unknown>
  const text = (key: string) => typeof about[key] === 'string'
  const textOrNull = (key: string) => about[key] === null || typeof about[key] === 'string'
  const textOrNone = (key: string) => about[key] === undefined || typeof about[key] === 'string'
  const { agents } = about
  const agentsWhole = typeof agents === 'object' && agents !== null && !Array.isArray(agents) && Object.values(agents).every((version) => version === null || typeof version === 'string')
  return text('host') && text('os') && text('evenKeel') && text('node') && textOrNull('git') && textOrNull('root') && typeof about.gitUser === 'boolean' && textOrNone('gitName') && textOrNone('gitEmail') && agentsWhole
}

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
