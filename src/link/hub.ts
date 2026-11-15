import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { HubStore, MachineRecord } from './hub-store.js'
import {
  API_VERSION, HEARTBEAT_MS, MISSED_PULSES, credentialsOf, encodeToken,
  type Command, type EventsAnswer, type EventsPost, type Frame, type MachineEvent, type MachineHello, type Refusal, type SnapshotPost,
} from './protocol.js'

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
}

export interface HubOptions {
  store: HubStore
  handlers: HubHandlers
  log: (line: string) => void
  heartbeatMs?: number
  now?: () => number
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

/**
 * The hub's end of the link. Commands are numbered per machine and kept in the store until the machine names their
 * number as taken; events are taken once, by their number. Everything about one machine runs in the order it was
 * called, so a command sent while the machine reconnects never overtakes the ones resent to it.
 */
export class HubEnd {
  private readonly live = new Map<string, Live>()
  private readonly queues = new Map<string, Promise<unknown>>()
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

  /** Keeps the command and sends it if the machine is connected; otherwise it goes at the next connection. */
  async send(machine: string, command: Command): Promise<number> {
    return this.queued(machine, async () => {
      const seq = await this.options.store.addCommand(machine, command, this.now())
      this.live.get(machine)?.sink.send({ kind: 'command', command: { ...command, seq } })
      return seq
    })
  }

  /** A machine opens its stream: the handshake, then every command it has not taken yet. */
  async open(authorization: string | undefined, hello: MachineHello, sink: FrameSink): Promise<Opened | Refusal> {
    const record = await this.known(authorization)
    if (record === undefined) return { refused: 'token' }
    if (hello.api !== API_VERSION) return { refused: 'version', api: API_VERSION }
    const machine = record.id
    return this.queued(machine, async () => {
      const { store } = this.options
      // The token may have been revoked while this waited its turn.
      const fresh = await store.machine(machine)
      if (fresh === undefined || fresh.revokedAt !== null) return { refused: 'token' } as const
      this.drop(machine)
      await store.seen(machine, hello.host, hello.api, this.now())
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
    if (record === undefined || record.revokedAt !== null) return undefined
    return timingSafeEqual(Buffer.from(hashOf(credentials.secret)), Buffer.from(record.secretHash)) ? record : undefined
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
    const run = (this.queues.get(machine) ?? Promise.resolve()).then(body, body)
    const settled = run.catch(() => {})
    this.queues.set(machine, settled)
    void settled.then(() => {
      if (this.queues.get(machine) === settled) this.queues.delete(machine)
    })
    return run
  }
}
