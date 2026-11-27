import type { LaunchEntry } from '../chain/model.js'
import { fail } from '../notice/notice.js'
import { colorOf, machineColors } from '../link/colors.js'
import { kindOf } from '../link/kinds.js'
import type { MachineKind } from '../state.js'
import type { MachineRecord } from '../link/hub-store.js'
import { HubEnd } from '../link/hub.js'
import { ASSIGN_COMMAND, HEARTBEAT_MS, type AssignPayload } from '../link/protocol.js'
import type { AddressChoice, HubBuild, MachineProjectSettings, MachineView, StateTooLarge, TakenFolder } from '../link/view.js'
import type { LimitsPlan, MachineAccounts } from '../limits/polls.js'
import type { RemoteMachine } from '../machine/remote.js'
import type { MachinePort } from '../machine/port.js'
import type { CloneProgress } from '../git/clone-progress.js'
import { samePath } from '../paths.js'
import * as accounts from './machine-network-accounts.js'
import * as briefing from './machine-network-briefs.js'
import { HubDoor } from './machine-network-door.js'
import { folderUnder, insideRoot, type MachineNetworkOptions, type NetworkHost, type NetworkPeers, type Peer, type PoolTarget } from './machine-network-options.js'
import * as pools from './machine-network-pool.js'

export type { AddressChoice, MachineView }
export { folderUnder, insideRoot }
export type { MachineNetworkOptions, NetworkPeers, PoolTarget }

/**
 * The hub's door for machines elsewhere (BTN-1242): a `HubEnd` of its own over the hub's store, serving every machine
 * but the hub's own, and the HTTPS listener behind it, open only while "Hub address for machines" is set. Each such
 * machine has its own mirror (`RemoteMachine`), its brief of the projects in its pool and its plan of account limits
 * (`peers`); the chain still launches only on the hub's own machine. Its other topics live in files of their own over
 * `NetworkHost`, each named by the comment above its members here.
 */
export class MachineNetwork {
  readonly hub: HubEnd
  private readonly host: NetworkHost
  private readonly door: HubDoor
  private readonly peers = new Map<string, Peer>()
  /** By machine and project, the machine whose mark holds the project's folder there; kept in memory, told again at the next assignment. */
  private readonly taken = new Map<string, Map<string, TakenFolder>>()
  /** The machines revoked here and, by project, its pool turned on: read by `refresh`, so the chain asks without a query. */
  private revokedIds = new Set<string>()
  private pools = new Map<string, string[]>()
  /** By project, every machine of its list, turned on or off; `undefined` until the first `refresh`. */
  private listed: Map<string, string[]> | undefined
  private machineNames: Record<string, string> = {}
  /** The own machine and the joined ones, in the hub's order, as `refresh` last read them; `live` drops the revoked. */
  private joinedIds: string[] = []
  private colorsById: Record<string, string> = {}
  private paletteById: Record<string, string> = {}
  private kindsById: Record<string, MachineKind> = {}
  /** By machine and project, the connect job's step that shows a clone's progress there. */
  private readonly clones = new Map<string, (progress: CloneProgress) => void>()
  /** By machine off the link, when this hub saw it go (BTN-1051): kept in memory only. */
  private readonly wentOff = new Map<string, number>()
  /** By machine whose snapshot is over the link's limit (BTN-1560), till the hub takes one: in memory only, told again at its next try. */
  private readonly tooLarge = new Map<string, StateTooLarge>()

  constructor(private readonly options: MachineNetworkOptions) {
    const hub = (): HubEnd => this.hub
    this.host = {
      options,
      get hub() {
        return hub()
      },
      peers: this.peers,
      taken: this.taken,
      clones: this.clones,
      wentOff: this.wentOff,
      tooLarge: this.tooLarge,
      refresh: () => this.refresh(),
      foreign: (machine) => this.foreign(machine),
      folderOf: (project, folder, root) => this.folderOf(project, folder, root),
      folderOn: (machine, project, root) => this.folderOn(machine, project, root),
      holds: (machine, project, owner) => this.holds(machine, project, owner),
      brief: (machine) => briefing.brief(this.host, machine),
    }
    this.door = new HubDoor(this.host)
    this.hub = new HubEnd({
      store: options.store,
      admits: (machine) => machine !== options.own(),
      heartbeatMs: HEARTBEAT_MS,
      version: options.version,
      ...(options.commit !== undefined && { commit: options.commit }),
      log: options.log,
      handlers: briefing.hubHandlers(this.host),
    })
  }

  /** The newest accounts of every machine elsewhere that has posted its facts: what the limits are planned from. */
  accounts(): MachineAccounts[] {
    return [...this.peers].flatMap(([machine, peer]) => {
      const facts = peer.remote.facts()
      return facts === undefined ? [] : [{ machine, online: this.hub.connected(machine), identities: facts.identities ?? {}, limits: facts.limits }]
    })
  }

  /** The machine elsewhere whose mirror holds the session; `undefined` — none of them. */
  holderOf(sessionId: string): string | undefined {
    for (const [machine, peer] of this.peers) if (peer.remote.page.sessions().some((view) => view.sessionId === sessionId)) return machine
    return undefined
  }

  /** A machine elsewhere but `except` whose sessions read hold a live session of the task (BTN-1625); `undefined` — none. */
  liveHolderOf(task: string, except: string): string | undefined {
    for (const [machine, peer] of this.peers) {
      const facts = peer.remote.facts()
      if (machine !== except && facts?.sessionsRead === true && facts.tasks[task]?.live !== undefined) return machine
    }
    return undefined
  }

  /** What the page reads of each machine elsewhere that has posted a snapshot since the hub started. */
  pages(): RemoteMachine['page'][] {
    return [...this.peers.values()].map((peer) => peer.remote.page)
  }

  /** Each machine elsewhere that has posted a snapshot since the hub started, with its mirror. */
  mirrors(): Array<[string, RemoteMachine]> {
    return [...this.peers].map(([machine, peer]) => [machine, peer.remote])
  }

  /** The mirror of a machine elsewhere; `undefined` — it has not posted a snapshot since the hub started. */
  remote(machine: string): RemoteMachine | undefined {
    return this.peers.get(machine)?.remote
  }

  /** The chain's port of a machine elsewhere; `undefined` — it has not posted a snapshot since the hub started, or was revoked. */
  port(machine: string): MachinePort | undefined {
    return this.peers.get(machine)?.port
  }

  /**
   * The machines elsewhere that take the chain's tasks now: online, their sessions read (BTN-993). The handshake refuses
   * another API, so each speaks the hub's protocol: another build or version of Even Keel takes tasks too (BTN-1609).
   */
  takers(): Array<{ id: string; capacity: number }> {
    return [...this.peers].flatMap(([id, peer]) => (this.hub.connected(id) && peer.remote.facts()?.sessionsRead === true ? [{ id, capacity: peer.capacity }] : []))
  }

  /** The machines of the project's pool, turned on, as `refresh` last read them. */
  poolOf(project: string): readonly string[] {
    return this.pools.get(project) ?? []
  }

  /**
   * How many machines the project's list "The project's machines" holds (BTN-1571): turned on or off, the own one too,
   * the revoked and never joined ones apart, as `pool` shows them; at least 1, the own machine of a project with none.
   * The most its width may be. `undefined` — not read yet.
   */
  machinesIn(project: string): number | undefined {
    if (this.listed === undefined) return undefined
    const live = new Set(this.live())
    return Math.max(1, (this.listed.get(project) ?? []).filter((machine) => live.has(machine)).length)
  }

  /** The hub's name of each machine it ever had, the own one and the revoked ones too, as `refresh` last read them. */
  names(): Record<string, string> {
    return this.machineNames
  }

  /**
   * The machines the hub has now (BTN-1552): the own one first, then the joined ones not revoked, as the machines panel
   * lists them. What decides "several machines"; `names` keeps the gone ones to label old sessions and lanes.
   */
  live(): string[] {
    const own = this.options.own()
    const ids = this.joinedIds.filter((id) => !this.revokedIds.has(id))
    return [...ids.filter((id) => id === own), ...ids.filter((id) => id !== own)]
  }

  /** The colour of each machine the hub ever had (BTN-1272), its own or the palette's, as `refresh` last read them. */
  colors(): Record<string, string> {
    return this.colorsById
  }

  /** The system and Docker of each machine elsewhere that reported them (BTN-1595), as `refresh` last read them. */
  kinds(): Record<string, MachineKind> {
    return this.kindsById
  }

  /** The palette's colour of each machine by its place, as if none had picked its own (BTN-1515). */
  paletteColors(): Record<string, string> {
    return this.paletteById
  }

  /** When the machine went off the link while this hub ran; `undefined` — it is on it, or was not seen since the start. */
  offlineSince(machine: string): number | undefined {
    return this.hub.connected(machine) ? undefined : this.wentOff.get(machine)
  }

  /** The machine's snapshot is over the link's limit and none has reached the hub since (BTN-1560); `undefined` — not so. */
  stateTooLarge(machine: string): StateTooLarge | undefined {
    return this.tooLarge.get(machine)
  }

  revoked(machine: string): boolean {
    return this.revokedIds.has(machine)
  }

  /** The machine elsewhere is connected now and not revoked: a task it holds goes on there (BTN-1270). */
  connected(machine: string): boolean {
    return !this.revokedIds.has(machine) && this.hub.connected(machine)
  }

  /** The machine elsewhere one of whose sessions works in the folder; `undefined` — none of them. */
  folderHolder(folder: string): string | undefined {
    for (const [machine, peer] of this.peers) if (peer.remote.page.sessions().some((view) => samePath(view.cwd, folder))) return machine
    return undefined
  }

  /** Reads the revoked machines and the projects' pools anew: at the start and after each change of them. */
  async refresh(): Promise<void> {
    const machines = await this.options.store.listMachines()
    this.revokedIds = new Set(machines.filter((record) => record.revokedAt !== null).map((record) => record.id))
    this.machineNames = Object.fromEntries(machines.map((record) => [record.id, record.name]))
    const own = this.options.own()
    this.joinedIds = machines.filter((record) => record.id === own || record.joinedAt !== null).map((record) => record.id)
    this.colorsById = machineColors(machines)
    this.paletteById = machineColors(machines.map(({ id }) => ({ id })))
    this.kindsById = Object.fromEntries(machines.filter((record) => record.id !== own && record.about !== null).map((record) => [record.id, kindOf(record.about)]))
    const { rows } = await this.options.db.query<{ project_id: string; machine_id: string; enabled: boolean }>('select project_id, machine_id, enabled from project_machines order by machine_id')
    const pools = new Map<string, string[]>()
    const listed = new Map<string, string[]>()
    for (const row of rows) {
      listed.set(row.project_id, [...(listed.get(row.project_id) ?? []), row.machine_id])
      if (row.enabled) pools.set(row.project_id, [...(pools.get(row.project_id) ?? []), row.machine_id])
    }
    this.pools = pools
    this.listed = listed
    this.options.poolCounted?.()
  }

  /** How many of the hub's tasks the machine runs at once (BTN-993). */
  async setCapacity(machine: string, capacity: number): Promise<void> {
    const record = await this.foreign(machine)
    if (!Number.isInteger(capacity) || capacity < 1) throw fail('request.required', { field: 'capacity' })
    await this.options.store.setCapacity(record.id, capacity)
    const peer = this.peers.get(record.id)
    if (peer !== undefined) peer.capacity = capacity
    this.options.log(`machines: machine ${record.id} (${record.name}) runs ${capacity} of the hub's task(s) at once`)
    this.options.changed()
  }

  /** The machine's colour (BTN-1272), the own one's too; `null` — back to the palette's. */
  async setColor(machine: string, color: string | null): Promise<void> {
    const record = await this.options.store.machine(machine)
    if (record === undefined || record.revokedAt !== null) throw fail('machines.unknown', {})
    const picked = color === null ? null : colorOf(color)
    if (picked === undefined) throw fail('request.required', { field: 'color' })
    await this.options.store.setColor(record.id, picked)
    await this.refresh()
    this.options.changed()
  }

  /** The hub's row of a machine, the own one too. */
  record(machine: string): Promise<MachineRecord | undefined> {
    return this.options.store.machine(machine)
  }

  /** Every machine's row, the own and the revoked ones too. */
  records(): Promise<MachineRecord[]> {
    return this.options.store.listMachines()
  }

  /** The projects whose folder on the machine another machine's mark holds. */
  takenOn(machine: string): TakenFolder[] {
    return [...(this.taken.get(machine)?.values() ?? [])]
  }

  // The accounts, sign-ins and services on a machine elsewhere: `machine-network-accounts.ts`.
  signIns() {
    return accounts.signIns(this.host)
  }

  login(machine: string, agent: string, account?: string, method?: string) {
    return accounts.login(this.host, machine, agent, account, method)
  }

  useGlobal(machine: string, agent: string) {
    return accounts.useGlobal(this.host, machine, agent)
  }

  token(machine: string, account: string, token: string, name?: string) {
    return accounts.token(this.host, machine, account, token, name)
  }

  sharedToken(machine: string, from: string) {
    return accounts.sharedToken(this.host, machine, from)
  }

  code(machine: string, code: string) {
    return accounts.code(this.host, machine, code)
  }

  cancel(machine: string) {
    return accounts.cancel(this.host, machine)
  }

  installCli(machine: string, agent: string) {
    return accounts.installCli(this.host, machine, agent)
  }

  checkClis(machine: string) {
    return accounts.checkClis(this.host, machine)
  }

  gitIdentity(machine: string, name: string, email: string) {
    return accounts.gitIdentity(this.host, machine, name, email)
  }

  follow(machine: string, build: HubBuild, force: boolean) {
    return accounts.follow(this.host, machine, build, force)
  }

  accountsOf(machine: string) {
    return accounts.accountsOf(this.host, machine)
  }

  async tellLimits(machine: string, plan: LimitsPlan): Promise<void> {
    const peer = this.peers.get(machine)
    if (peer === undefined) throw new Error(`no mirror of machine ${machine}`)
    await peer.remote.tellLimits(plan)
  }

  // The hub's handlers and the briefs: `machine-network-briefs.ts`.
  catchUp() {
    return briefing.catchUp(this.host)
  }

  launched(machine: string, entry: LaunchEntry) {
    briefing.launched(this.host, machine, entry)
  }

  /**
   * The project's folder on the machine is held by `owner`'s mark, or (`undefined`) no longer is. The mark of a machine
   * this hub revoked is free (its marks came off with its token), so the hub alone tells the machine to take it over.
   * Answers whether the folder is to be taken over.
   */
  async holds(machine: string, project: string, owner: { machine: string; name: string } | undefined): Promise<boolean> {
    const held = this.taken.get(machine) ?? new Map<string, TakenFolder>()
    if (owner === undefined) {
      held.delete(project)
      return false
    }
    const record = await this.options.store.machine(owner.machine)
    if (record !== undefined && record.revokedAt !== null) {
      held.delete(project)
      this.options.log(`machines: the folder of project ${project} on machine ${machine} has the mark of machine ${owner.machine} (${record.name}), revoked here: it is taken over`)
      return true
    }
    const name = record?.name ?? (owner.name || owner.machine)
    held.set(project, { project, machine: owner.machine, name })
    this.taken.set(machine, held)
    this.options.log(`machines: the folder of project ${project} on machine ${machine} is served by machine ${owner.machine} (${name}): refused there`)
    this.options.changed()
    return false
  }

  /**
   * "Take the folder over", confirmed by the person: the machine marks the project's folder as its own in place of
   * `owner`'s mark, the one its refusal named. A folder no longer held by that machine is refused `machines.notTaken`.
   * No `machine` — the hub's own, whose refusal the page shows as the chain's pause.
   */
  async takeOver(named: string | undefined, project: string, owner: string): Promise<void> {
    const machine = named ?? this.options.own()
    const isOwn = machine === this.options.own()
    const record = isOwn ? undefined : await this.foreign(machine)
    if (this.taken.get(machine)?.get(project)?.machine !== owner) throw fail('machines.notTaken', {})
    this.taken.get(machine)!.delete(project)
    this.options.log(`machines: machine ${machine} takes the folder of project ${project} over from machine ${owner}`)
    if (isOwn) await this.options.takeOverOwn?.(project, owner)
    else {
      const folder = await this.folderOn(machine, project, record!.about?.root ?? null)
      if (folder === undefined) throw fail('machines.unknownProject', {})
      await this.hub.send(machine, { type: ASSIGN_COMMAND, project, folder, payload: { takeOver: owner } satisfies AssignPayload })
    }
    this.options.changed()
  }

  /** The project's folder named by a pool row, else the hub's folder name inside the machine's folder of projects. */
  private folderOf(project: string, folder: string | null, root: string | null): string | undefined {
    if (folder !== null) return folder
    const repo = this.options.repoOf(project)
    return repo === undefined || root === null ? undefined : folderUnder(root, repo)
  }

  private async folderOn(machine: string, project: string, root: string | null): Promise<string | undefined> {
    const { rows } = await this.options.db.query<{ folder: string | null }>('select folder from project_machines where project_id = $1 and machine_id = $2', [project, machine])
    return this.folderOf(project, rows[0]?.folder ?? null, root)
  }

  // The listener and the connection strings: `machine-network-door.ts`.
  apply() {
    return this.door.apply()
  }

  addresses() {
    return this.door.addresses()
  }

  invite(name: string, given?: string, color?: string, proxied?: boolean) {
    return this.door.invite(name, given, color, proxied)
  }

  async revoke(machine: string): Promise<void> {
    const record = await this.foreign(machine)
    await this.hub.revoke(record.id)
    this.peers.delete(record.id)
    this.taken.delete(record.id)
    this.revokedIds.add(record.id)
    this.options.log(`machines: machine ${record.id} (${record.name}) was revoked`)
    this.options.poolCounted?.()
    this.options.changed()
  }

  async list(): Promise<MachineView[]> {
    const own = this.options.own()
    const { rows } = await this.options.db.query<{ project_id: string; machine_id: string }>('select project_id, machine_id from project_machines where enabled')
    return (await this.options.store.listMachines()).filter((record) => record.id !== own).map((record) => ({
      id: record.id,
      name: record.name,
      createdAt: record.createdAt,
      revokedAt: record.revokedAt,
      inviteExpires: record.joinedAt === null ? record.inviteExpires : null,
      joinedAt: record.joinedAt,
      host: record.host,
      about: record.about,
      online: this.hub.connected(record.id),
      projects: rows.filter((row) => row.machine_id === record.id).map((row) => row.project_id),
      taken: this.takenOn(record.id),
    }))
  }

  // The project's pool: `machine-network-pool.ts`.
  foldersOf(machine: string) {
    return pools.foldersOf(this.host, machine)
  }

  attach(machine: string, projects: string[]) {
    return pools.attach(this.host, machine, projects)
  }

  pool(project: string) {
    return pools.pool(this.host, project)
  }

  setSettings(project: string, machine: string, values: MachineProjectSettings) {
    return pools.setSettings(this.host, project, machine, values)
  }

  afterGreenPool(project: string, machine?: string) {
    return pools.afterGreenPool(this.host, project, machine)
  }

  projectsOf(machine: string) {
    return pools.projectsOf(this.host, machine)
  }

  markAfterGreen(project: string, machine: string, commit: string) {
    return pools.markAfterGreen(this.host, project, machine, commit)
  }

  setEnabled(project: string, machine: string, enabled: boolean) {
    return pools.setEnabled(this.host, project, machine, enabled)
  }

  target(machine: string) {
    return pools.target(this.host, machine)
  }

  folders(target: PoolTarget) {
    return pools.folders(this.host, target)
  }

  watchClone(machine: string, project: string, show: (progress: CloneProgress) => void) {
    return pools.watchClone(this.host, machine, project, show)
  }

  place(target: PoolTarget, project: string, folder: string, copyFrom?: string) {
    return pools.place(this.host, target, project, folder, copyFrom)
  }

  unplace(machine: string, project: string) {
    return pools.unplace(this.host, machine, project)
  }

  async close(): Promise<void> {
    this.hub.stop()
    await this.door.stopListening()
  }

  private async foreign(machine: string): Promise<MachineRecord> {
    const record = await this.options.store.machine(machine)
    if (record === undefined || record.id === this.options.own() || record.revokedAt !== null) throw fail('machines.unknown', {})
    return record
  }
}
