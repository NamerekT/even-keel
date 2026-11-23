import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { HubStore, MachineRecord } from './hub-store.js'
import {
  API_VERSION, HEARTBEAT_MS, INVITE_MS, MISSED_PULSES, credentialsOf, encodeToken,
  type Command, type EventsAnswer, type EventsPost, type Frame, type HookAnswer, type HookPost, type HookRequest, type JoinAnswer, type JoinPost, type MachineEvent, type MachineHello, type McpAnswer, type McpPost,
  type McpRequest, type Refusal, type SnapshotPost, type TallyAnswer, type TallyPost, type CredentialsAnswer, type CredentialsPost,
} from './protocol.js'

/** A connection string just issued: the line is shown once, the hub keeps only the hash of its secret. */
export interface Invite {
  line: string
  machine: string
  expiresAt: number
}

/** Where a machine's frames go: the stream of its connection. */
export interface FrameSink {
  send(frame: Frame): void
  close(): void
}

export interface HubHandlers {
  /** One event of a machine, once: a throw leaves it untaken and the machine sends it again. */
  event(machine: string, event: MachineEvent): Promise<void> | void
  /** What the machine holds right now, the first thing it says on every connection. */
  snapshot(machine: string, snapshot: unknown): Promise<void> | void
  online?(machine: string): void
  /** The connection is gone: the stream closed, two pulses were missed, a newer connection took its place or the token was revoked. */
  offline?(machine: string): void
  /** A session's request to an MCP server of the hub, carried by the machine's gateway (BTN-990). */
  mcp?(machine: string, request: McpRequest): Promise<McpAnswer>
  /** A session's hook asking the hub's page, carried from the machine's receiver (BTN-1260). */
  hook?(machine: string, request: HookRequest): Promise<HookAnswer>
  /** Rows of the machine's own Tally collector (BTN-1280); without a handler none are taken. */
  tally?(machine: string, rows: unknown): Promise<TallyAnswer>
  /** The tokens of a project's remotes for one git call of the machine (BTN-1541); without a handler, none. */
  credentials?(machine: string, project: string, urls: string[]): Promise<CredentialsAnswer> | CredentialsAnswer
}

export interface HubOptions {
  store: HubStore
  handlers: HubHandlers
  log: (line: string) => void
  heartbeatMs?: number
  now?: () => number
  /** The machines this end serves; another one's token is refused here (the hub's own machine is not served over the network). */
  admits?: (machine: string) => boolean
  /** The hub's version of Even Keel, told to a machine of another API version with its refusal. */
  version?: string
  /** The commit of the checkout the hub runs from, told with `version` (BTN-1275); none for a package of npm. */
  commit?: string
}

/** One piece of a machine's queued work while it runs. */
interface Turn {
  machine: string
  running: boolean
}

interface Live {
  connection: string
  sink: FrameSink
  ping: ReturnType<typeof setInterval>
  watchdog?: ReturnType<typeof setTimeout>
}

export interface Opened {
  connection: string
  /** The carrier's word that the stream ended. */
  closed(): void
}

const hashOf = (secret: string): string => createHash('sha256').update(secret).digest('hex')
const sameHash = (secret: string, hash: string): boolean => {
  const given = Buffer.from(hashOf(secret))
  const kept = Buffer.from(hash)
  return given.length === kept.length && timingSafeEqual(given, kept)
}

/**
 * The hub's end of the link. Commands are numbered per machine and kept in the store until the machine names their
 * number as taken; events are taken once, by their number. Everything about one machine runs in the order it was
 * called, so a command sent while the machine reconnects never overtakes the ones resent to it.
 */
export class HubEnd {
  private readonly live = new Map<string, Live>()
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly turn = new AsyncLocalStorage<Turn>()
  private readonly heartbeatMs: number
  private readonly now: () => number

  constructor(private readonly options: HubOptions) {
    this.heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS
    this.now = options.now ?? Date.now
  }

  /** A new machine and its connection token: the only time the secret is seen, the store keeps its hash. */
  async issue(name: string, hub: string, fingerprint: string): Promise<string> {
    const machine = randomUUID()
    const secret = randomBytes(32).toString('base64url')
    await this.options.store.addMachine({ id: machine, name, secretHash: hashOf(secret), createdAt: this.now() })
    return encodeToken({ hub, fingerprint, machine, secret })
  }

  /**
   * A connection string for a machine elsewhere (BTN-1242): it opens only the join, once and for `INVITE_MS`, where it
   * is exchanged for the machine's own secret. A new one revokes the strings issued before and never joined with.
   */
  async invite(name: string, hub: string, fingerprint: string): Promise<Invite> {
    const { store } = this.options
    for (const record of await store.listMachines()) {
      if (record.inviteExpires !== null && record.joinedAt === null && record.revokedAt === null) await store.revoke(record.id, this.now())
    }
    const machine = randomUUID()
    const secret = randomBytes(32).toString('base64url')
    const expiresAt = this.now() + INVITE_MS
    await store.addMachine({ id: machine, name, secretHash: hashOf(secret), createdAt: this.now(), inviteExpires: expiresAt })
    return { line: encodeToken({ hub, fingerprint, machine, secret }), machine, expiresAt }
  }

  /**
   * A machine joins with its connection string: once, before it expires. The answer is the machine's own secret, and
   * from here the string's works no more.
   */
  async join(authorization: string | undefined, post: JoinPost): Promise<JoinAnswer | Refusal> {
    const credentials = credentialsOf(authorization)
    if (credentials === undefined) return { refused: 'token' }
    if (post.api !== API_VERSION) return this.otherVersion()
    return this.queued(credentials.machine, async () => {
      const { store } = this.options
      const record = await store.machine(credentials.machine)
      if (record === undefined || record.revokedAt !== null || record.inviteExpires === null || this.options.admits?.(record.id) === false) return { refused: 'token' } as const
      if (record.joinedAt !== null) return { refused: 'used' } as const
      if (!sameHash(credentials.secret, record.secretHash)) return { refused: 'token' } as const
      if (this.now() > record.inviteExpires) return { refused: 'expired' } as const
      const secret = randomBytes(32).toString('base64url')
      if (!(await store.joined(record.id, hashOf(secret), post.about, this.now()))) return { refused: 'used' } as const
      this.options.log(`link: machine ${record.id} (${post.about.host}) joined with its connection string`)
      return { secret }
    })
  }

  /** The token stops working and the machine's connection is closed. Its commands stay: nothing takes them. */
  async revoke(machine: string): Promise<void> {
    await this.queued(machine, async () => {
      await this.options.store.revoke(machine, this.now())
      this.drop(machine)
    })
  }

  connected(machine: string): boolean {
    return this.live.has(machine)
  }

  /**
   * Keeps the command and sends it if the machine is connected; otherwise it goes at the next connection. A send made
   * while the machine's own turn runs (a handler of its event or snapshot) is part of that turn: queued behind it, it
   * would wait for the turn that waits for it, and the machine's queue would stand for good (BTN-1555).
   */
  async send(machine: string, command: Command): Promise<number> {
    const body = async () => {
      const seq = await this.options.store.addCommand(machine, command, this.now())
      this.live.get(machine)?.sink.send({ kind: 'command', command: { ...command, seq } })
      return seq
    }
    const turn = this.turn.getStore()
    return turn?.machine === machine && turn.running ? body() : this.queued(machine, body)
  }

  /** A machine opens its stream: the handshake, then every command it has not taken yet. */
  async open(authorization: string | undefined, hello: MachineHello, sink: FrameSink): Promise<Opened | Refusal> {
    const record = await this.known(authorization)
    if (record === undefined) return { refused: 'token' }
    if (hello.api !== API_VERSION) {
      // The report's shape has not changed since API 10: the page names the machine's version beside the hub's.
      if (typeof hello.about === 'object' && hello.about !== null) await this.options.store.described(record.id, hello.about)
      return this.otherVersion()
    }
    const machine = record.id
    return this.queued(machine, async () => {
      const { store } = this.options
      // The token may have been revoked while this waited its turn.
      const fresh = await store.machine(machine)
      if (fresh === undefined || fresh.revokedAt !== null) return { refused: 'token' } as const
      this.drop(machine)
      await store.seen(machine, hello.host, hello.api, this.now())
      if (hello.about !== undefined) await store.described(machine, hello.about)
      await store.dropCommands(machine, hello.lastCommand)
      const connection = randomUUID()
      const live: Live = { connection, sink, ping: setInterval(() => sink.send({ kind: 'ping' }), this.heartbeatMs) }
      this.live.set(machine, live)
      this.watch(machine, live)
      sink.send({ kind: 'hello', hello: { api: API_VERSION, connection, heartbeatMs: this.heartbeatMs, lastEvent: fresh.lastEvent } })
      for (const command of await store.commandsAfter(machine, hello.lastCommand)) sink.send({ kind: 'command', command })
      this.options.handlers.online?.(machine)
      return { connection, closed: () => { if (this.live.get(machine) === live) this.drop(machine) } }
    })
  }

  /** The machine's events and its pulse: an event at or below the last taken number is a repeat and is dropped. */
  async events(authorization: string | undefined, post: EventsPost): Promise<EventsAnswer | Refusal> {
    return this.posted(authorization, post, async (machine, lastEvent) => {
      let taken = lastEvent
      for (const event of post.events) {
        if (event.seq <= taken) continue
        try {
          await this.options.handlers.event(machine, event)
        } catch (error) {
          this.options.log(`link: event ${event.seq} (${event.type}) of machine ${machine} was not taken: ${error instanceof Error ? error.message : String(error)}`)
          break
        }
        await this.options.store.eventTaken(machine, event.seq)
        taken = event.seq
      }
      return taken
    })
  }

  async snapshot(authorization: string | undefined, post: SnapshotPost): Promise<EventsAnswer | Refusal> {
    return this.posted(authorization, post, async (machine, lastEvent) => {
      await this.options.handlers.snapshot(machine, post.snapshot)
      return lastEvent
    })
  }

  /**
   * A request of the machine's gateway to an MCP server of the hub. Not queued with the machine's other work: a call
   * may take minutes, and the machine's events and pulse must not wait behind it. It counts as the machine's pulse.
   */
  async mcp(authorization: string | undefined, post: McpPost): Promise<McpAnswer | Refusal> {
    const handler = this.options.handlers.mcp
    return this.asked(authorization, post.connection, (machine) => handler?.(machine, post.request) ?? { status: 404, headers: {}, body: '' })
  }

  /** A session's hook asking the hub's page (BTN-1260): as `mcp`, not queued and counted as the machine's pulse. */
  async hook(authorization: string | undefined, post: HookPost): Promise<HookAnswer | Refusal> {
    const handler = this.options.handlers.hook
    return this.asked(authorization, post.connection, (machine) => handler?.(machine, post.request) ?? { status: 404, body: '' })
  }

  /** Rows of the machine's Tally collector (BTN-1280): as `mcp`, not queued with its events and counted as its pulse. */
  async tally(authorization: string | undefined, post: TallyPost): Promise<TallyAnswer | Refusal> {
    const handler = this.options.handlers.tally
    return this.asked(authorization, post.connection, (machine) => handler?.(machine, post.rows) ?? { taken: false })
  }

  /** The tokens of a project's remotes for one git call (BTN-1541): as `mcp`, not queued and counted as the pulse. */
  async credentials(authorization: string | undefined, post: CredentialsPost): Promise<CredentialsAnswer | Refusal> {
    const handler = this.options.handlers.credentials
    return this.asked(authorization, post.connection, (machine) => handler?.(machine, post.project, post.urls) ?? { credentials: [] })
  }

  private otherVersion(): Refusal {
    const { version, commit } = this.options
    return { refused: 'version', api: API_VERSION, ...(version !== undefined && { evenKeel: version }), ...(commit !== undefined && { commit }) }
  }

  private async asked<T>(authorization: string | undefined, connection: string, answer: (machine: string) => Promise<T> | T): Promise<T | Refusal> {
    const known = await this.known(authorization)
    if (known === undefined) return { refused: 'token' }
    const live = this.live.get(known.id)
    if (live === undefined || live.connection !== connection) return { refused: 'connection' }
    this.watch(known.id, live)
    return answer(known.id)
  }

  /** Closes every connection, for the shutdown. */
  stop(): void {
    for (const machine of [...this.live.keys()]) this.drop(machine)
  }

  private async posted(
    authorization: string | undefined,
    post: { connection: string; lastCommand: number },
    body: (machine: string, lastEvent: number) => Promise<number>,
  ): Promise<EventsAnswer | Refusal> {
    const known = await this.known(authorization)
    if (known === undefined) return { refused: 'token' }
    const machine = known.id
    return this.queued(machine, async () => {
      const live = this.live.get(machine)
      if (live === undefined || live.connection !== post.connection) return { refused: 'connection' } as const
      this.watch(machine, live)
      await this.options.store.dropCommands(machine, post.lastCommand)
      const record = await this.options.store.machine(machine)
      return { lastEvent: await body(machine, record?.lastEvent ?? 0) }
    })
  }

  private async known(authorization: string | undefined): Promise<MachineRecord | undefined> {
    const credentials = credentialsOf(authorization)
    if (credentials === undefined) return undefined
    const record = await this.options.store.machine(credentials.machine)
    if (record === undefined || record.revokedAt !== null || this.options.admits?.(record.id) === false) return undefined
    // A connection string opens only the join.
    if (record.inviteExpires !== null && record.joinedAt === null) return undefined
    return sameHash(credentials.secret, record.secretHash) ? record : undefined
  }

  /** Two pulses without a post from the machine: the connection is broken. */
  private watch(machine: string, live: Live): void {
    clearTimeout(live.watchdog)
    live.watchdog = setTimeout(() => {
      if (this.live.get(machine) !== live) return
      this.options.log(`link: machine ${machine} missed ${MISSED_PULSES} pulses, its connection is closed`)
      this.drop(machine)
    }, this.heartbeatMs * MISSED_PULSES)
  }

  private drop(machine: string): void {
    const live = this.live.get(machine)
    if (live === undefined) return
    this.live.delete(machine)
    clearInterval(live.ping)
    clearTimeout(live.watchdog)
    live.sink.close()
    this.options.handlers.offline?.(machine)
  }

  private queued<T>(machine: string, body: () => Promise<T>): Promise<T> {
    // Work the turn starts and leaves running past its end keeps the context, but no longer counts as the turn.
    const turn: Turn = { machine, running: false }
    const step = async () => {
      turn.running = true
      try {
        return await this.turn.run(turn, body)
      } finally {
        turn.running = false
      }
    }
    const run = (this.queues.get(machine) ?? Promise.resolve()).then(step, step)
    const settled = run.catch(() => {})
    this.queues.set(machine, settled)
    void settled.then(() => {
      if (this.queues.get(machine) === settled) this.queues.delete(machine)
    })
    return run
  }
}
