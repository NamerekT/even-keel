import { HubEnd, type Opened } from './hub.js'
import type { HubStore, MachineRecord, NewMachine } from './hub-store.js'
import { MachineEnd, type HubTransport, type MachineOptions, type StreamSink } from './machine.js'
import type { Consent, MachineStore } from './machine-store.js'
import { partsOf } from './body-size.js'
import {
  EVENTS_PATH, SNAPSHOT_PATH, TooLarge, bearerOf, isRefusal, parseToken,
  type Command, type EventsAnswer, type EventsPost, type Frame, type MachineAbout, type MachineEvent, type MachineHello, type McpAnswer, type McpPost, type McpRequest, type NumberedCommand, type Refusal,
  type HookAnswer, type HookPost, type HookRequest, type SnapshotPost, type TallyAnswer, type TallyPost, type CredentialsAnswer, type CredentialsPost, type SkillsAnswer, type SkillsPost, type GitAnswer, type GitPost,
} from './protocol.js'

export const HUB_ADDRESS = 'https://hub.example.com:4750'
export const FINGERPRINT = 'ab'.repeat(32)

export class MemoryHubStore implements HubStore {
  readonly machines = new Map<string, MachineRecord & { lastCommand: number }>()
  readonly commands = new Map<string, NumberedCommand[]>()

  async machine(id: string) {
    const found = this.machines.get(id)
    return found === undefined ? undefined : { ...found }
  }

  async addMachine({ inviteExpires, ...machine }: NewMachine) {
    this.machines.set(machine.id, { ...machine, revokedAt: null, host: null, lastEvent: 0, lastCommand: 0, inviteExpires: inviteExpires ?? null, joinedAt: null, about: null })
    this.commands.set(machine.id, [])
  }

  async listMachines() {
    return [...this.machines.values()].map((record) => ({ ...record }))
  }

  async joined(id: string, secretHash: string, about: MachineAbout, at: number) {
    const found = this.machines.get(id)
    if (found === undefined || found.joinedAt !== null || found.revokedAt !== null) return false
    Object.assign(found, { secretHash, about, joinedAt: at, name: found.name === '' ? about.host : found.name })
    return true
  }

  async described(id: string, about: MachineAbout) {
    const found = this.machines.get(id)
    if (found !== undefined) found.about = about
  }

  async setCapacity(id: string, capacity: number) {
    const found = this.machines.get(id)
    if (found !== undefined) found.capacity = capacity
  }

  async setColor(id: string, color: string | null) {
    const found = this.machines.get(id)
    if (found !== undefined) found.color = color
  }

  async revoke(id: string, at: number) {
    const found = this.machines.get(id)
    if (found !== undefined && found.revokedAt === null) found.revokedAt = at
  }

  async seen(id: string, host: string) {
    const found = this.machines.get(id)
    if (found !== undefined) found.host = host
  }

  async addCommand(id: string, command: Command) {
    const found = this.machines.get(id)
    if (found === undefined) throw new Error(`link: no machine ${id}`)
    found.lastCommand += 1
    this.commands.get(id)!.push({ ...command, seq: found.lastCommand })
    return found.lastCommand
  }

  async commandsAfter(id: string, seq: number) {
    return (this.commands.get(id) ?? []).filter((command) => command.seq > seq)
  }

  async dropCommands(id: string, upTo: number) {
    this.commands.set(id, (this.commands.get(id) ?? []).filter((command) => command.seq > upTo))
  }

  async eventTaken(id: string, seq: number) {
    const found = this.machines.get(id)
    if (found !== undefined && found.lastEvent < seq) found.lastEvent = seq
  }
}

export class MemoryMachineStore implements MachineStore {
  outbox: MachineEvent[] = []
  next = 1
  readonly commands = new Map<number, { done: boolean }>()
  agreed: Consent[] = []
  rootFolder: string | undefined

  async appendEvent(type: string, at: number, payload?: unknown) {
    const event: MachineEvent = { seq: this.next++, type, at, ...(payload === undefined ? {} : { payload }) }
    this.outbox.push(event)
    return event
  }

  async eventsAfter(seq: number, limit: number) {
    return this.outbox.filter((event) => event.seq > seq).slice(0, limit)
  }

  async dropEvents(upTo: number) {
    this.outbox = this.outbox.filter((event) => event.seq > upTo)
    if (this.next <= upTo) this.next = upTo + 1
  }

  async lastCommand() {
    return Math.max(0, ...this.commands.keys())
  }

  async commandReceived(seq: number) {
    if (seq <= Math.max(0, ...this.commands.keys())) return false
    this.commands.set(seq, { done: false })
    return true
  }

  async commandDone(seq: number) {
    const found = this.commands.get(seq)
    if (found !== undefined) found.done = true
  }

  async unfinishedCommands() {
    return [...this.commands].filter(([, command]) => !command.done).map(([seq]) => seq)
  }

  async consents() {
    return [...this.agreed]
  }

  async root() {
    return this.rootFolder
  }

  async agree(project: string, folder: string) {
    if (!this.agreed.some((consent) => consent.project === project && consent.folder === folder)) this.agreed.push({ project, folder })
  }

  async withdraw(project: string, folder?: string) {
    this.agreed = this.agreed.filter((consent) => consent.project !== project || (folder !== undefined && consent.folder !== folder))
  }
}

interface Stream {
  sink: StreamSink
  opened?: Opened
  shut: boolean
  held: Frame[]
}

/** What crosses the wire is JSON, as on the real link: neither end holds an object of the other. */
const carried = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** The carrier between the two ends, in memory, with the ways a real one breaks. */
export class Wire implements HubTransport {
  /** The hub is not reachable: a stream closes at once, a post fails. */
  down = false
  /** A proxy keeps the stream's frames to itself until `release`. */
  hold = false
  /** The stream stays open and its frames are lost. */
  mute = false
  /** A post never gets its answer. */
  hang = false
  /** The hub takes a post and its answer is lost. */
  loseAnswers = false
  /** The largest snapshot or events post that goes; `undefined` — any. */
  bodyLimit: number | undefined
  readonly opens: Array<{ at: number; hello: MachineHello }> = []
  readonly posts: Array<{ kind: 'snapshot' | 'events'; post: EventsPost | SnapshotPost }> = []
  private current?: Stream

  constructor(private readonly hub: HubEnd, public authorization: string) {}

  open(hello: MachineHello, sink: StreamSink) {
    this.opens.push({ at: Date.now(), hello })
    if (this.down) {
      queueMicrotask(() => sink.closed())
      return { close: () => {} }
    }
    const stream: Stream = { sink, shut: false, held: [] }
    this.current = stream
    sink.opened()
    void this.hub.open(this.authorization, hello, {
      send: (sent) => {
        if (stream.shut || this.mute) return
        const frame = carried(sent)
        if (this.hold) stream.held.push(frame)
        else sink.frame(frame)
      },
      close: () => {
        if (stream.shut) return
        stream.shut = true
        sink.closed()
      },
    }).then((result) => {
      if (isRefusal(result)) {
        stream.shut = true
        sink.closed(result)
      } else if (stream.shut) result.closed()
      else stream.opened = result
    })
    return {
      close: () => {
        if (stream.shut) return
        stream.shut = true
        stream.opened?.closed()
      },
    }
  }

  /** The connection drops under both ends. */
  cut(): void {
    const stream = this.current
    if (stream === undefined || stream.shut) return
    stream.shut = true
    stream.opened?.closed()
    stream.sink.closed()
  }

  /** The proxy lets go of what it kept. */
  release(): void {
    this.hold = false
    const stream = this.current
    if (stream === undefined || stream.shut) return
    for (const frame of stream.held.splice(0)) stream.sink.frame(frame)
  }

  /** A frame the machine gets once more, as after a replay. */
  replay(frame: Frame): void {
    this.current?.sink.frame(frame)
  }

  async events(post: EventsPost): Promise<EventsAnswer | Refusal> {
    this.posts.push({ kind: 'events', post })
    this.limited(EVENTS_PATH, post)
    return this.carry(() => this.hub.events(this.authorization, carried(post)))
  }

  async snapshot(post: SnapshotPost): Promise<EventsAnswer | Refusal> {
    this.posts.push({ kind: 'snapshot', post })
    this.limited(SNAPSHOT_PATH, post)
    return this.carry(() => this.hub.snapshot(this.authorization, carried(post)))
  }

  /** As the transport: a post over `bodyLimit` bytes is not sent. */
  private limited(path: string, post: unknown): void {
    const bytes = Buffer.byteLength(JSON.stringify(post))
    if (this.bodyLimit !== undefined && bytes > this.bodyLimit) throw new TooLarge(path, bytes, partsOf(post))
  }

  async mcp(post: McpPost): Promise<McpAnswer | Refusal> {
    return this.carry(async () => carried(await this.hub.mcp(this.authorization, carried(post))))
  }

  async hook(post: HookPost): Promise<HookAnswer | Refusal> {
    return this.carry(async () => carried(await this.hub.hook(this.authorization, carried(post))))
  }

  async tally(post: TallyPost): Promise<TallyAnswer | Refusal> {
    return this.carry(async () => carried(await this.hub.tally(this.authorization, carried(post))))
  }

  async credentials(post: CredentialsPost): Promise<CredentialsAnswer | Refusal> {
    return this.carry(async () => carried(await this.hub.credentials(this.authorization, carried(post))))
  }

  async git(post: GitPost): Promise<GitAnswer | Refusal> {
    return this.carry(async () => carried(await this.hub.git(this.authorization, carried(post))))
  }

  async skills(post: SkillsPost): Promise<SkillsAnswer | Refusal> {
    return this.carry(async () => carried(await this.hub.skills(this.authorization, carried(post))))
  }

  private async carry<T>(call: () => Promise<T>): Promise<T> {
    if (this.down) throw new Error('the hub is unreachable')
    if (this.hang) return new Promise<T>(() => {})
    const answer = await call()
    if (this.loseAnswers) throw new Error('the answer was lost')
    return answer
  }
}

/** A hub with one machine issued, the wire between them and what each end saw. */
export async function bench() {
  const hubStore = new MemoryHubStore()
  const machineStore = new MemoryMachineStore()
  const log: string[] = []
  const taken: MachineEvent[] = []
  const snapshots: unknown[] = []
  const presence: string[] = []
  const ran: NumberedCommand[] = []
  const refuseEvents = { on: false }
  /** What the hub does with an event after it is taken, as a handler of the service would. */
  const onEvent: { then?: (machine: string, event: MachineEvent) => Promise<void> } = {}
  const asked: { machine: string; request: McpRequest }[] = []
  const hooked: { machine: string; request: HookRequest }[] = []
  const tallied: { machine: string; rows: unknown }[] = []
  const tallyOn = { on: true }
  const credentialed: { machine: string; project: string; urls: string[] }[] = []
  const hub = new HubEnd({
    store: hubStore,
    version: '0.4.0',
    commit: 'c0ffee0000000000000000000000000000000000',
    log: (line) => log.push(line),
    handlers: {
      event: async (machine, event) => {
        if (refuseEvents.on) throw new Error('the hub is busy')
        taken.push(event)
        await onEvent.then?.(machine, event)
      },
      snapshot: (_machine, snapshot) => void snapshots.push(snapshot),
      online: () => void presence.push('online'),
      offline: () => void presence.push('offline'),
      mcp: async (machine, request) => {
        asked.push({ machine, request })
        return { status: 200, headers: { 'content-type': 'application/json' }, body: `{"echo":${JSON.stringify(request.path)}}` }
      },
      hook: async (machine, request) => {
        hooked.push({ machine, request })
        return { status: 200, body: `{"echo":${JSON.stringify(request.path)}}` }
      },
      tally: async (machine, rows) => {
        if (!tallyOn.on) return { taken: false }
        tallied.push({ machine, rows })
        return { taken: true }
      },
      credentials: async (machine, project, urls) => {
        credentialed.push({ machine, project, urls })
        return { credentials: urls.map((url) => ({ url, username: 'x-access-token', password: 'ghp_example', profile: { id: 'p1', name: 'John GitHub' } })) }
      },
      skills: (_machine, install) => ({
        skills: install === 'held' ? { version: '1.0.0+0000abcd', files: [{ path: 'example/SKILL.md', data: Buffer.from('# Example\n').toString('base64') }] } : null,
      }),
    },
  })
  const token = parseToken(await hub.issue('Example server', HUB_ADDRESS, FINGERPRINT))!
  const wire = new Wire(hub, bearerOf(token))
  const machine = (options: Partial<MachineOptions> = {}) => new MachineEnd({
    transport: wire,
    store: machineStore,
    host: 'example-host',
    snapshot: () => ({ sessions: [] }),
    command: (command) => void ran.push(command),
    log: (line) => log.push(line),
    ...options,
  })
  return { hub, hubStore, machineStore, wire, token, machine, log, taken, snapshots, presence, ran, refuseEvents, onEvent, asked, hooked, tallied, tallyOn, credentialed }
}
