import { hostname } from 'node:os'
import { isInside } from '../paths.js'
import type { Consent, MachineStore } from './machine-store.js'
import {
  API_VERSION, ASSIGN_COMMAND, EVENT_BATCH, FAILED_EVENT, HEARTBEAT_MS, INTERRUPTED_EVENT, MISSED_PULSES, RECONNECT_FIRST_MS, RECONNECT_MAX_MS, REFUSED_EVENT, isRefusal,
  type Command, type EventsAnswer, type EventsPost, type Frame, type HubHello, type MachineAbout, type MachineHello, type McpAnswer, type McpPost, type McpRequest, type NumberedCommand,
  type Refusal, type SnapshotPost,
} from './protocol.js'

/** What a stream tells the machine: it is connected, a frame came, it ended (with the hub's refusal, if it gave one). */
export interface StreamSink {
  opened(): void
  frame(frame: Frame): void
  closed(refusal?: Refusal): void
}

/** How the machine reaches its hub. A post rejects when it did not get through; the stream never throws, it closes. */
export interface HubTransport {
  open(hello: MachineHello, sink: StreamSink): { close(): void }
  events(post: EventsPost): Promise<EventsAnswer | Refusal>
  snapshot(post: SnapshotPost): Promise<EventsAnswer | Refusal>
  mcp(post: McpPost): Promise<McpAnswer | Refusal>
}

export type LinkState = 'offline' | 'connecting' | 'online'

/** The message codes of the machine's page: the stream is held back by a proxy, the token is not taken, the versions differ. */
export type LinkNotice = 'link.buffered' | 'link.token' | 'link.version'

export interface LinkStatus {
  state: LinkState
  notice?: LinkNotice
}

export interface MachineOptions {
  transport: HubTransport
  store: MachineStore
  /** What the machine holds right now: its tasks, its live sessions and their state. */
  snapshot: () => unknown | Promise<unknown>
  /** Runs one command, already checked against what the machine agreed to. A throw is reported to the hub. */
  command: (command: NumberedCommand) => Promise<void> | void
  log: (line: string) => void
  /**
   * Commands are taken in order and their handlers run side by side: a long one — a check of main, a launch — does not
   * hold a stop or a query behind it. Without it a handler ends before the next command is taken.
   */
  concurrent?: boolean
  host?: string
  /** What the machine tells about itself at every handshake; the hub's own machine has nothing to tell. */
  about?: () => Promise<MachineAbout>
  /** The status changed. */
  changed?: () => void
  heartbeatMs?: number
  api?: number
  now?: () => number
}

/**
 * Why the machine does not run a command: `project` — it never agreed to serve it, `folder` — the folder is outside
 * the ones agreed for the project, or named without a project. The folder a command touches is its `folder` field,
 * never something in its payload. Inside the machine's folder of projects (`root`) any project's folder is agreed to;
 * a project the machine knows no folder of is still refused when the command names none.
 */
export function refusalOf(command: Command, consents: Consent[], root?: string): 'project' | 'folder' | undefined {
  const { project, folder } = command
  if (project === undefined) return folder === undefined ? undefined : 'folder'
  const inRoot = root !== undefined && folder !== undefined && isInside(folder, root)
  const agreed = consents.filter((consent) => consent.project === project)
  if (agreed.length === 0) return root === undefined || folder === undefined ? 'project' : inRoot ? undefined : 'folder'
  if (folder === undefined || inRoot) return undefined
  return agreed.some((consent) => isInside(folder, consent.folder)) ? undefined : 'folder'
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * The machine's end of the link. It opens the stream and opens it again after every break, says what it holds first,
 * then sends the events its hub has not taken; a command is recorded before it runs, so it runs at most once.
 */
export class MachineEnd {
  private state: LinkState = 'offline'
  private notice: LinkNotice | undefined
  private contactAt: number | undefined
  /** Grows with every connection and every break: what belongs to an older one is ignored. */
  private generation = 0
  private stopped = true
  private stream: { close(): void } | undefined
  private connection: string | undefined
  private opened = false
  private frames = 0
  private pause = RECONNECT_FIRST_MS
  private heartbeatMs: number
  private watchdog: ReturnType<typeof setTimeout> | undefined
  private retry: ReturnType<typeof setTimeout> | undefined
  private pulse: ReturnType<typeof setInterval> | undefined
  private posting: Promise<void> = Promise.resolve()
  private commands: Promise<void> = Promise.resolve()
  private readonly api: number
  private readonly now: () => number

  constructor(private readonly options: MachineOptions) {
    this.heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS
    this.api = options.api ?? API_VERSION
    this.now = options.now ?? Date.now
  }

  status(): LinkStatus {
    return { state: this.state, ...(this.notice === undefined ? {} : { notice: this.notice }) }
  }

  /** When the hub was last heard: a frame or an answer to a post; `undefined` — not since the start. */
  contact(): number | undefined {
    return this.contactAt
  }

  async start(): Promise<void> {
    const { store } = this.options
    this.stopped = false
    for (const seq of await store.unfinishedCommands()) {
      this.options.log(`link: command ${seq} was cut short by a stop of the machine, it is not run again`)
      await store.appendEvent(INTERRUPTED_EVENT, this.now(), { seq })
      await store.commandDone(seq, this.now())
    }
    await this.connect()
  }

  stop(): void {
    this.stopped = true
    this.release()
    this.set('offline', this.notice)
  }

  /** Keeps the event and sends it as soon as the hub is there; the number is the event's. */
  async emit(type: string, payload?: unknown): Promise<number> {
    const event = await this.options.store.appendEvent(type, this.now(), payload)
    void this.flush(false)
    return event.seq
  }

  /**
   * A session's request to an MCP server of the hub (BTN-990); `undefined` — the hub is not reachable now: no
   * connection, the post failed or was refused. It does not break the connection: the pulse tells a lost hub.
   */
  async mcp(request: McpRequest): Promise<McpAnswer | undefined> {
    const connection = this.connection
    if (connection === undefined || this.state !== 'online') return undefined
    try {
      const answer = await this.options.transport.mcp({ connection, request })
      return isRefusal(answer) ? undefined : answer
    } catch (error) {
      this.options.log(`link: a request to an MCP server of the hub did not get through: ${messageOf(error)}`)
      return undefined
    }
  }

  /** Resolves once the events kept at the call were posted to the hub; at once without a connection. */
  flushed(): Promise<void> {
    return this.flush(false)
  }

  private set(state: LinkState, notice: LinkNotice | undefined): void {
    if (state === this.state && notice === this.notice) return
    this.state = state
    this.notice = notice
    this.options.changed?.()
  }

  private async connect(): Promise<void> {
    if (this.stopped) return
    const generation = ++this.generation
    const mine = () => generation === this.generation && !this.stopped
    this.set('connecting', this.notice)
    const lastCommand = await this.options.store.lastCommand()
    const about = await this.aboutNow()
    if (!mine()) return
    this.opened = false
    this.frames = 0
    this.posting = Promise.resolve()
    this.watch(generation)
    const stream = this.options.transport.open({ api: this.api, host: this.options.host ?? hostname(), lastCommand, ...(about === undefined ? {} : { about }) }, {
      opened: () => { if (mine()) this.opened = true },
      frame: (frame) => { if (mine()) this.frame(generation, frame) },
      closed: (refusal) => { if (mine()) this.lost(refusal) },
    })
    if (mine()) this.stream = stream
    else stream.close()
  }

  /** A report that fails to read leaves the hub with the last one it has: the connection does not wait for it. */
  private async aboutNow(): Promise<MachineAbout | undefined> {
    if (this.options.about === undefined) return undefined
    try {
      return await this.options.about()
    } catch (error) {
      this.options.log(`link: what the machine is could not be read: ${messageOf(error)}`)
      return undefined
    }
  }

  private frame(generation: number, frame: Frame): void {
    this.frames += 1
    this.contactAt = this.now()
    this.watch(generation)
    if (frame.kind === 'hello') this.greeted(generation, frame.hello)
    // The handshake alone may be a proxy's first flush; a pulse shows that the stream flows.
    else if (frame.kind === 'ping') this.set(this.state, this.notice === 'link.buffered' ? undefined : this.notice)
    else this.take(frame.command)
  }

  private greeted(generation: number, hello: HubHello): void {
    const { transport, store } = this.options
    this.connection = hello.connection
    this.heartbeatMs = hello.heartbeatMs
    this.pause = RECONNECT_FIRST_MS
    this.watch(generation)
    void this.post(generation, async (live) => {
      const snapshot = await this.options.snapshot()
      const answer = await transport.snapshot({ connection: hello.connection, snapshot, lastCommand: await store.lastCommand() })
      if (!live()) return
      if (isRefusal(answer)) return this.lost(answer)
      this.contactAt = this.now()
      await store.dropEvents(answer.lastEvent)
      if (!live()) return
      this.set('online', this.notice === 'link.buffered' ? this.notice : undefined)
      clearInterval(this.pulse)
      this.pulse = setInterval(() => void this.flush(true), this.heartbeatMs)
    })
    void this.flush(false)
  }

  /**
   * Sends what the outbox holds, in order. With `pulse` it posts even when there is nothing to send: the post is the
   * machine's pulse and names the last command taken.
   */
  private flush(pulse: boolean): Promise<void> {
    const { transport, store } = this.options
    if (this.connection === undefined) return Promise.resolve()
    return this.post(this.generation, async (live) => {
      for (let first = true; this.connection !== undefined; first = false) {
        const events = await store.eventsAfter(0, EVENT_BATCH)
        if (events.length === 0 && !(pulse && first)) return
        const answer = await transport.events({ connection: this.connection, events, lastCommand: await store.lastCommand() })
        if (!live()) return
        if (isRefusal(answer)) return this.lost(answer)
        this.contactAt = this.now()
        await store.dropEvents(answer.lastEvent)
        // The hub did not take them all: the next pulse brings the rest again.
        if (!live() || events.length === 0 || answer.lastEvent < events.at(-1)!.seq) return
      }
    })
  }

  /** One post after another over the connection they were made for; a post that fails breaks it. */
  private post(generation: number, body: (live: () => boolean) => Promise<void>): Promise<void> {
    const live = () => generation === this.generation && !this.stopped
    const run = this.posting.then(async () => {
      if (!live()) return
      try {
        await body(live)
      } catch (error) {
        if (!live()) return
        this.options.log(`link: a post to the hub did not get through: ${messageOf(error)}`)
        this.lost()
      }
    })
    this.posting = run
    return run
  }

  private take(command: NumberedCommand): void {
    this.commands = this.commands
      .then(() => this.run(command))
      .catch((error: unknown) => this.options.log(`link: command ${command.seq} (${command.type}) was not finished: ${messageOf(error)}`))
  }

  private async run(command: NumberedCommand): Promise<void> {
    const { store } = this.options
    const { seq, type } = command
    if (!(await store.commandReceived(seq, this.now()))) return
    void this.flush(true)
    // A project's folder the hub names counts as agreed only inside the root: an assignment never gets one of its own.
    const assigned = type === ASSIGN_COMMAND
    const reason = assigned && (command.project === undefined || command.folder === undefined)
      ? 'folder'
      : refusalOf(command, assigned ? [] : await store.consents(), await store.root())
    if (reason !== undefined) {
      this.options.log(`link: command ${seq} (${type}) is refused: ${reason === 'project' ? 'this machine did not agree to its project' : 'its folder is outside the agreed ones'}`)
      await this.emit(REFUSED_EVENT, { seq, type, reason })
      await store.commandDone(seq, this.now())
      return
    }
    if (assigned) {
      await store.agree(command.project!, command.folder!)
      this.options.log(`link: the hub put project ${command.project} into ${command.folder}`)
      await store.commandDone(seq, this.now())
      return
    }
    const handled = this.handle(command)
    if (this.options.concurrent === true) void handled.catch((error: unknown) => this.options.log(`link: command ${seq} (${type}) was not finished: ${messageOf(error)}`))
    else await handled
  }

  private async handle(command: NumberedCommand): Promise<void> {
    const { seq, type } = command
    try {
      await this.options.command(command)
    } catch (error) {
      this.options.log(`link: command ${seq} (${type}) failed: ${messageOf(error)}`)
      await this.emit(FAILED_EVENT, { seq, type, error: messageOf(error) })
    }
    await this.options.store.commandDone(seq, this.now())
  }

  /** Two pulses without a frame: the connection is broken — or, if not one frame came over it, held back on the way. */
  private watch(generation: number): void {
    clearTimeout(this.watchdog)
    this.watchdog = setTimeout(() => {
      if (generation !== this.generation) return
      if (this.opened && this.frames === 0) {
        if (this.notice !== 'link.buffered') {
          this.options.log('link: the stream to the hub is open and nothing comes over it: a proxy on the way seems to hold it back; turn its buffering off for the hub\'s address (docs/machines.md, "Behind a proxy")')
        }
        this.notice = 'link.buffered'
      } else {
        this.options.log(`link: the hub missed ${MISSED_PULSES} pulses, connecting again`)
      }
      this.lost()
    }, this.heartbeatMs * MISSED_PULSES)
  }

  private release(): void {
    this.generation += 1
    clearTimeout(this.watchdog)
    clearTimeout(this.retry)
    clearInterval(this.pulse)
    this.stream?.close()
    this.stream = undefined
    this.connection = undefined
  }

  /** The connection is gone: the next attempt comes after the pause, at once the longest one when the hub refused. */
  private lost(refusal?: Refusal): void {
    this.release()
    let wait = this.pause
    let notice = this.notice
    if (refusal?.refused === 'token') {
      if (notice !== 'link.token') this.options.log('link: the hub does not take this machine\'s connection token: it is unknown to it or revoked')
      notice = 'link.token'
      wait = RECONNECT_MAX_MS
    } else if (refusal?.refused === 'version') {
      if (notice !== 'link.version') this.options.log(`link: the hub speaks API ${refusal.api}, this machine ${this.api}: both need the same version of Even Keel`)
      notice = 'link.version'
      wait = RECONNECT_MAX_MS
    } else {
      this.pause = Math.min(this.pause * 2, RECONNECT_MAX_MS)
    }
    this.set('offline', notice)
    this.retry = setTimeout(() => void this.connect(), wait)
  }
}
