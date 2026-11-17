import type { Server } from 'node:https'
import { networkInterfaces } from 'node:os'
import { basename, posix, win32 } from 'node:path'
import type { TokenAccountOf } from '../account/model.js'
import { installCommandOf } from '../cli-install.js'
import { fail } from '../notice/notice.js'
import { hubUrlOf } from '../link/address.js'
import { colorOf, machineColors } from '../link/colors.js'
import type { HubCertificate } from '../link/cert.js'
import { createHubServer } from '../link/hub-server.js'
import type { HubStore, MachineRecord } from '../link/hub-store.js'
import { HubEnd, type HubHandlers, type Invite } from '../link/hub.js'
import { ASSIGN_COMMAND, HEARTBEAT_MS, TAKEN_EVENT, type AssignPayload, type FolderTaken, type HookAnswer, type HookRequest, type McpAnswer, type McpRequest } from '../link/protocol.js'
import type { AddressChoice, MachineSignIn, MachineView, TakenFolder } from '../link/view.js'
import type { LimitsPlan, MachineAccounts } from '../limits/polls.js'
import type { HubBrief } from '../machine/brief.js'
import { SELECTION_EVENT, type MachineSelection } from '../machine/config.js'
import { RemoteMachine, type RemoteDeps } from '../machine/remote.js'
import type { MachinePort } from '../machine/port.js'
import { CLONE_PROGRESS_EVENT, type CloneTold, type MachineFolders, type MachineServices } from '../machine/services.js'
import type { CloneProgress } from '../git/clone-progress.js'
import type { ProjectPool } from '../link/view.js'
import { isInside, samePath } from '../paths.js'
import type { Queryable } from '../storage/database.js'
import { KEPT_WRITE_EVENT, type KeptWrite } from '../taskmcp/machine.js'
import { BriefSender } from './hub-brief.js'
import { machineAccountOf } from './machine-page.js'

export type { AddressChoice, MachineView }

/** The monitor's word that the machine has read its sessions: the hub catches it up with its brief. */
const SESSIONS_READ_EVENT = 'sessions.read'

/**
 * What the hub gives a machine elsewhere past its door (BTN-1247): its own mirror, its brief, the plan of its account
 * limits and the hub's MCP servers. Without it the machine's events stay in its outbox.
 */
export interface NetworkPeers {
  /** The hub's port of the machine, but how it sends and whom it stands for. */
  remote: (machine: string) => Omit<RemoteDeps, 'send' | 'machine' | 'catchUp' | 'changed'>
  /** The hub's brief for a machine whose projects are those of its pool, each in its folder there. */
  brief: (folders: Record<string, string>) => HubBrief
  /** A machine's facts or connection changed: the limits are planned again. */
  changed: () => void
  /** A new connection of the machine: what it was told before is not known to hold. */
  connected: (machine: string) => void
  mcp: (machine: string, request: McpRequest) => Promise<McpAnswer>
  /** A hook of a session on the machine asking the hub's page (BTN-1260). */
  hook: (machine: string, request: HookRequest) => Promise<HookAnswer>
  write: (machine: string, write: KeptWrite) => Promise<void>
}

interface Peer {
  remote: RemoteMachine
  /** The chain's port of the machine (`MachinePool`). */
  port: MachinePort
  /** How many of the hub's tasks it runs at once, read at each snapshot. */
  capacity: number
  briefs: BriefSender
  /** The folders of the machine's pool, read before each brief. */
  folders: Record<string, string>
  /** The hub's name of the machine, read at each snapshot: the page's state is built without a query. */
  name: string
}

export interface MachineNetworkOptions {
  db: Queryable
  store: HubStore
  certificate: () => Promise<HubCertificate>
  /** The hub's own machine: served through the local link, never over the network. */
  own: () => string
  /** "Hub address for machines", read live. */
  address: () => string | null
  /** Writes "Hub address for machines" (a refused value throws); absent — `invite` never changes it. */
  saveAddress?: (address: string) => void
  port: number
  /** The hub's folder of a project; `undefined` — no such project. */
  repoOf: (project: string) => string | undefined
  allowedHosts: () => string[]
  /** `EVEN_KEEL_HOST`: offered when it is no loopback or wildcard address. */
  serviceHost: string
  /** The hub's version of Even Keel: a machine installs the same one. */
  version: string
  /** A machine joined, connected or went away: the page asks for the list again. */
  changed: () => void
  peers?: NetworkPeers
  /** The own machine takes the project's folder over from `owner`'s mark. */
  takeOverOwn?: (project: string, owner: string) => Promise<void>
  /** The claude.ai account of a hub's Claude folder with a full sign-in; `undefined` — none known (BTN-1002). */
  hubAccount?: (key: string) => TokenAccountOf | undefined
  log: (line: string) => void
}

const LOOPBACK = /^(127\.|::1$|localhost$)/
const WILDCARD = new Set(['0.0.0.0', '::', ''])

/** The folder a project gets inside a machine's folder of projects: the hub's folder name, in the machine's way of writing paths. */
export function folderUnder(root: string, repo: string): string {
  const name = basename(repo.replace(/[\\/]+$/, '').replaceAll('\\', '/'))
  return (windowsRoot(root) ? win32 : posix).join(root, name)
}

const windowsRoot = (root: string): boolean => root.includes('\\') || /^[A-Za-z]:/.test(root)

/** Whether `folder` is inside the machine's folder of projects, compared the way the machine writes paths. */
export function insideRoot(folder: string, root: string): boolean {
  return isInside(folder, root, windowsRoot(root) ? 'win32' : 'linux')
}

/** A machine of a project's pool as the connect job finds it: joined, with a folder of projects. */
export interface PoolTarget {
  id: string
  name: string
  root: string
}

/**
 * The hub's door for machines elsewhere (BTN-1242): a `HubEnd` of its own over the hub's store, serving every machine
 * but the hub's own, and the HTTPS listener behind it, open only while "Hub address for machines" is set. Each such
 * machine has its own mirror (`RemoteMachine`), its brief of the projects in its pool and its plan of account limits
 * (`peers`); the chain still launches only on the hub's own machine.
 */
export class MachineNetwork {
  readonly hub: HubEnd
  private server: Server | undefined
  private listeningFor: string | null = null
  private applying: Promise<void> = Promise.resolve()
  private readonly peers = new Map<string, Peer>()
  /** By machine and project, the machine whose mark holds the project's folder there; kept in memory, told again at the next assignment. */
  private readonly taken = new Map<string, Map<string, TakenFolder>>()
  /** The machines revoked here and, by project, its pool turned on: read by `refresh`, so the chain asks without a query. */
  private revokedIds = new Set<string>()
  private pools = new Map<string, string[]>()
  private machineNames: Record<string, string> = {}
  private colorsById: Record<string, string> = {}
  /** By machine and project, the connect job's step that shows a clone's progress there. */
  private readonly clones = new Map<string, (progress: CloneProgress) => void>()
  /** By machine off the link, when this hub saw it go (BTN-1051): kept in memory only. */
  private readonly wentOff = new Map<string, number>()

  constructor(private readonly options: MachineNetworkOptions) {
    this.hub = new HubEnd({
      store: options.store,
      admits: (machine) => machine !== options.own(),
      heartbeatMs: HEARTBEAT_MS,
      log: options.log,
      handlers: this.handlers(),
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

  /** The mirror of a machine elsewhere; `undefined` — it has not posted a snapshot since the hub started. */
  remote(machine: string): RemoteMachine | undefined {
    return this.peers.get(machine)?.remote
  }

  /** The chain's port of a machine elsewhere; `undefined` — it has not posted a snapshot since the hub started, or was revoked. */
  port(machine: string): MachinePort | undefined {
    return this.peers.get(machine)?.port
  }

  /** The machines elsewhere that take the chain's tasks now: online, their sessions read (BTN-993). */
  takers(): Array<{ id: string; capacity: number }> {
    return [...this.peers].flatMap(([id, peer]) =>
      this.hub.connected(id) && peer.remote.facts()?.sessionsRead === true ? [{ id, capacity: peer.capacity }] : [])
  }

  /** The machines of the project's pool, turned on, as `refresh` last read them. */
  poolOf(project: string): readonly string[] {
    return this.pools.get(project) ?? []
  }

  /** The hub's name of each machine it ever had, the own one and the revoked ones too, as `refresh` last read them. */
  names(): Record<string, string> {
    return this.machineNames
  }

  /** The colour of each machine the hub ever had (BTN-1272), its own or the palette's, as `refresh` last read them. */
  colors(): Record<string, string> {
    return this.colorsById
  }

  /** When the machine went off the link while this hub ran; `undefined` — it is on it, or was not seen since the start. */
  offlineSince(machine: string): number | undefined {
    return this.hub.connected(machine) ? undefined : this.wentOff.get(machine)
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
    this.colorsById = machineColors(machines)
    const { rows } = await this.options.db.query<{ project_id: string; machine_id: string }>('select project_id, machine_id from project_machines where enabled order by machine_id')
    const pools = new Map<string, string[]>()
    for (const row of rows) pools.set(row.project_id, [...(pools.get(row.project_id) ?? []), row.machine_id])
    this.pools = pools
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

  /** The projects of the machine's pool, each with its folder there and whether the machine takes its tasks. */
  async foldersOf(machine: string): Promise<Array<{ project: string; folder: string; enabled: boolean }>> {
    const own = machine === this.options.own()
    const root = own ? null : ((await this.options.store.machine(machine))?.about?.root ?? null)
    const { rows } = await this.options.db.query<{ project_id: string; folder: string | null; enabled: boolean }>(
      'select project_id, folder, enabled from project_machines where machine_id = $1 order by project_id',
      [machine],
    )
    return rows.flatMap((row) => {
      const folder = own ? this.options.repoOf(row.project_id) : this.folderOf(row.project_id, row.folder, root)
      return folder === undefined ? [] : [{ project: row.project_id, folder, enabled: row.enabled }]
    })
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

  /**
   * Each machine elsewhere's accounts and its sign-in under way, as its last post showed them (BTN-1245): what the hub's
   * page offers to sign in to there. Only the panel's names and states: the credentials never leave the machine.
   */
  signIns(): MachineSignIn[] {
    return [...this.peers].flatMap(([machine, peer]) => {
      const panel = peer.remote.page.panel()
      if (panel === undefined) return []
      const { login } = panel
      return [{
        machine,
        name: peer.name,
        online: this.hub.connected(machine),
        accounts: panel.accounts.map(machineAccountOf),
        login: login === null ? null : {
          agent: login.agent,
          ...(login.method !== undefined && { method: login.method }),
          target: login.target,
          startedAt: login.startedAt,
          urls: login.urls,
          deviceCode: login.deviceCode,
          output: login.output,
          error: login.error,
          codeSent: login.codeSent,
        },
        missing: panel.missing,
      }]
    })
  }

  /**
   * Starts a sign-in on the machine through its CLI (`docs/machines.md`, "Signing in on a machine"): again in its folder
   * `account` when it has one, else in a new folder named after the account signed in. The link and the code go
   * through the hub; the token the CLI gets stays in the machine's folder.
   */
  async login(machine: string, agent: string, account?: string, method?: string): Promise<void> {
    const control = await this.accountsOf(machine)
    const has = account !== undefined && this.peers.get(machine)?.remote.page.panel()?.accounts.some((entry) => entry.key === account) === true
    this.options.log(`machines: a sign-in of ${agent} is started on machine ${machine}${has ? ` in its folder ${account}` : ''}`)
    if (has) await control.renew(account)
    else await control.add(agent, method)
  }

  /**
   * A Claude folder on the machine signed in with a long token of `claude setup-token` (BTN-1002), tied to the hub's
   * folder `account`'s claude.ai account, so the hub hands it that account's limits. The token passes through the hub
   * only as the command's payload and is not logged; the machine checks it with one short turn.
   */
  async token(machine: string, account: string, token: string, name = ''): Promise<void> {
    const of = this.options.hubAccount?.(account)
    if (of === undefined) throw fail('account.unknown', { key: account })
    const control = await this.accountsOf(machine)
    this.options.log(`machines: a long token of ${of.email ?? of.account} is added on machine ${machine}`)
    await control.addLongToken(name, token, null, of)
  }

  /** The code the person got on the sign-in page, for the machine's CLI waiting for it; it is not logged. */
  async code(machine: string, code: string): Promise<void> {
    await (await this.accountsOf(machine)).code(code)
  }

  async cancel(machine: string): Promise<void> {
    await (await this.accountsOf(machine)).cancel()
  }

  private async accountsOf(machine: string): Promise<MachineServices['account']> {
    const record = await this.foreign(machine)
    const peer = this.peers.get(record.id)
    if (peer === undefined || !this.hub.connected(record.id)) throw fail('machines.offline', { name: record.name })
    return peer.remote.services().account
  }

  async tellLimits(machine: string, plan: LimitsPlan): Promise<void> {
    const peer = this.peers.get(machine)
    if (peer === undefined) throw new Error(`no mirror of machine ${machine}`)
    await peer.remote.tellLimits(plan)
  }

  /** Sends every machine online the brief that changed since the one it took. */
  async catchUp(): Promise<void> {
    for (const machine of this.peers.keys()) if (this.hub.connected(machine)) await this.brief(machine)
  }

  private handlers(): HubHandlers {
    const { peers, log } = this.options
    const changed = (machine: string, online: boolean) => {
      if (online) this.wentOff.delete(machine)
      else this.wentOff.set(machine, Date.now())
      this.options.changed()
    }
    if (peers === undefined) {
      return {
        snapshot: () => {},
        event: () => {
          throw new Error('the events of a machine elsewhere are taken only by a hub that serves them')
        },
        online: (machine) => changed(machine, true),
        offline: (machine) => changed(machine, false),
      }
    }
    return {
      snapshot: async (machine, snapshot) => {
        const peer = this.peer(machine, peers)
        const record = await this.options.store.machine(machine)
        peer.name = record?.name ?? machine
        peer.capacity = record?.capacity ?? 1
        peers.connected(machine)
        // A new connection may be a new process of the machine, which holds no brief yet.
        peer.briefs.forget()
        await peer.remote.handlers().snapshot(machine, snapshot)
        void this.brief(machine)
      },
      event: async (machine, event) => {
        if (event.type === SELECTION_EVENT) {
          // The hub's settings are its own machine's: a choice made on a machine elsewhere stays there.
          const selection = event.payload as MachineSelection
          log(`machines: machine ${machine} chose ${selection.kind} ${selection.value} for ${selection.provider}; the hub's settings are not changed by it`)
        } else if (event.type === TAKEN_EVENT) await this.refused(machine, event.payload as FolderTaken)
        else if (event.type === KEPT_WRITE_EVENT) await peers.write(machine, event.payload as KeptWrite)
        else if (event.type === SESSIONS_READ_EVENT) void this.brief(machine)
        else if (event.type === CLONE_PROGRESS_EVENT) {
          const told = event.payload as CloneTold
          this.clones.get(`${machine}\0${told.project}`)?.(told.progress)
        } else await this.peer(machine, peers).remote.handlers().event(machine, event)
      },
      mcp: (machine, request) => peers.mcp(machine, request),
      hook: (machine, request) => peers.hook(machine, request),
      online: (machine) => changed(machine, true),
      offline: (machine) => {
        changed(machine, false)
        peers.changed()
      },
    }
  }

  private peer(machine: string, peers: NetworkPeers): Peer {
    let peer = this.peers.get(machine)
    if (peer !== undefined) return peer
    const remote: RemoteMachine = new RemoteMachine({
      ...peers.remote(machine),
      send: (to, command) => this.hub.send(to, command),
      machine: () => machine,
      changed: () => peers.changed(),
    })
    const made: Peer = { remote, port: remote.port(), capacity: 1, folders: {}, name: machine, briefs: new BriefSender(() => peers.brief(made.folders), (brief) => remote.tellBrief(brief)) }
    peer = made
    this.peers.set(machine, peer)
    return peer
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

  private async refused(machine: string, taken: FolderTaken): Promise<void> {
    if (await this.holds(machine, taken.project, taken)) {
      await this.hub.send(machine, { type: ASSIGN_COMMAND, project: taken.project, folder: taken.folder, payload: { takeOver: taken.machine } satisfies AssignPayload })
    }
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

  /**
   * The machine's brief, its pool's folders read anew. A machine turned off keeps its projects there: their packages
   * install before its folder is checked, and a task it holds goes on; the chain pulls only from the ones turned on.
   */
  private async brief(machine: string): Promise<void> {
    const peer = this.peers.get(machine)
    if (peer === undefined) return
    try {
      const root = (await this.options.store.machine(machine))?.about?.root ?? null
      const { rows } = await this.options.db.query<{ project_id: string; folder: string | null }>('select project_id, folder from project_machines where machine_id = $1', [machine])
      const folders: Record<string, string> = {}
      for (const row of rows) {
        const folder = this.folderOf(row.project_id, row.folder, root)
        if (folder !== undefined) folders[row.project_id] = folder
      }
      peer.folders = folders
      await peer.briefs.send()
    } catch (error) {
      this.options.log(`machines: the brief for machine ${machine} was not taken: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** Opens or closes the listener by the setting as it is now; called at the start and at every change of the settings. */
  apply(): Promise<void> {
    this.applying = this.applying.then(() => this.refresh()).then(() => this.applyNow()).catch((error: unknown) => {
      this.options.log(`machines: the listener for machines did not start: ${error instanceof Error ? error.message : String(error)}`)
    })
    return this.applying
  }

  /** The names the page offers for the setting, each once. */
  addresses(): AddressChoice[] {
    const choices: AddressChoice[] = this.options.allowedHosts().map((address) => ({ address, from: 'allowedHosts' }))
    for (const [adapter, entries] of Object.entries(networkInterfaces())) {
      for (const entry of entries ?? []) {
        if (entry.internal || LOOPBACK.test(entry.address) || entry.address.startsWith('169.254.') || /^fe80:/i.test(entry.address)) continue
        choices.push({ address: entry.family === 'IPv6' ? `[${entry.address}]` : entry.address, from: 'adapter', adapter })
      }
    }
    const host = this.options.serviceHost.trim().toLowerCase()
    if (!WILDCARD.has(host) && !LOOPBACK.test(host)) choices.push({ address: host, from: 'service' })
    return choices.filter((choice, index) => choices.findIndex((other) => other.address === choice.address) === index)
  }

  /**
   * A connection string for a machine to join with, and the one command that installs the machine with it; the strings
   * issued before and never joined with stop working. `given` — the address the window chose (BTN-1056): it becomes
   * "Hub address for machines" first. No name — the machine is named by its host when it joins.
   */
  async invite(name: string, given?: string): Promise<Invite & { command: string }> {
    const chosen = given?.trim().toLowerCase()
    if (chosen && chosen !== this.options.address()) {
      this.options.saveAddress?.(chosen)
      await this.apply()
    }
    const address = this.options.address()
    const url = address === null ? undefined : hubUrlOf(address, this.options.port)
    if (url === undefined) throw fail('machines.noAddress', {})
    const { fingerprint } = await this.options.certificate()
    const invite = await this.hub.invite(name.trim(), url, fingerprint)
    this.options.log(`machines: a connection string for "${name.trim() || '(its host)'}" was issued, good until ${new Date(invite.expiresAt).toISOString()}`)
    return { ...invite, command: installCommandOf(this.options.version, invite.line) }
  }

  async revoke(machine: string): Promise<void> {
    const record = await this.foreign(machine)
    await this.hub.revoke(record.id)
    this.peers.delete(record.id)
    this.taken.delete(record.id)
    this.revokedIds.add(record.id)
    this.options.log(`machines: machine ${record.id} (${record.name}) was revoked`)
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

  /**
   * Puts the machine into the pools of the projects and tells it the folder of each: inside its folder of projects,
   * named as on the hub. The machine agrees to it by itself; a folder outside its root it refuses.
   */
  async attach(machine: string, projects: string[]): Promise<void> {
    const record = await this.foreign(machine)
    if (record.joinedAt === null) throw fail('machines.notJoined', {})
    const root = record.about?.root ?? null
    if (root === null) throw fail('machines.noRoot', {})
    const repos = projects.map((project) => [project, this.options.repoOf(project)] as const)
    if (repos.some(([, repo]) => repo === undefined)) throw fail('machines.unknownProject', {})
    for (const [project] of repos) {
      await this.options.db.query(
        'insert into project_machines (project_id, machine_id) values ($1, $2) on conflict (project_id, machine_id) do update set enabled = true',
        [project, record.id],
      )
      this.taken.get(record.id)?.delete(project)
      await this.hub.send(record.id, { type: ASSIGN_COMMAND, project, folder: (await this.folderOn(record.id, project, root))! })
    }
    await this.refresh()
    this.options.log(`machines: machine ${record.id} (${record.name}) was given ${projects.length} project(s)`)
    if (this.hub.connected(record.id)) void this.brief(record.id)
    this.options.changed()
  }

  /** The project's pool for its section "Machines" (BTN-1271): the own machine's folder is the project's repository. */
  async pool(project: string): Promise<ProjectPool> {
    const repo = this.options.repoOf(project)
    if (repo === undefined) throw fail('machines.unknownProject', {})
    const own = this.options.own()
    const records = (await this.options.store.listMachines()).filter((record) => record.revokedAt !== null ? false : record.id === own || record.joinedAt !== null)
    const { rows } = await this.options.db.query<{ machine_id: string; folder: string | null; enabled: boolean }>(
      'select machine_id, folder, enabled from project_machines where project_id = $1 order by machine_id',
      [project],
    )
    const folderIn = (record: MachineRecord, folder: string | null) => (record.id === own ? repo : this.folderOf(project, folder, record.about?.root ?? null) ?? null)
    const online = (record: MachineRecord) => record.id === own || this.hub.connected(record.id)
    return {
      machines: rows.flatMap((row) => {
        const record = records.find((each) => each.id === row.machine_id)
        if (record === undefined) return []
        return [{ id: record.id, name: record.name, own: record.id === own, online: online(record), folder: folderIn(record, row.folder) ?? '', enabled: row.enabled }]
      }),
      others: records
        .filter((record) => !rows.some((row) => row.machine_id === record.id))
        .map((record) => ({ id: record.id, name: record.name, own: record.id === own, online: online(record), folder: folderIn(record, null) })),
    }
  }

  /**
   * Turns the machine's taking of the project's tasks on or off; a task it holds goes on either way. The own machine
   * is put into the pool by this alone: its folder is the project's repository, checked when the project was added.
   */
  async setEnabled(project: string, machine: string, enabled: boolean): Promise<void> {
    if (this.options.repoOf(project) === undefined) throw fail('machines.unknownProject', {})
    if (machine === this.options.own()) {
      await this.options.db.query(
        'insert into project_machines (project_id, machine_id, enabled) values ($1, $2, $3) on conflict (project_id, machine_id) do update set enabled = $3',
        [project, machine, enabled],
      )
    } else {
      const record = await this.foreign(machine)
      const { rows } = await this.options.db.query('update project_machines set enabled = $3 where project_id = $1 and machine_id = $2 returning machine_id', [project, record.id, enabled])
      if (rows.length === 0) throw fail('pool.notInPool', {})
    }
    this.options.log(`machines: machine ${machine} ${enabled ? 'takes' : 'no longer takes'} the tasks of project ${project}`)
    await this.poolChanged(machine)
  }

  /** A machine elsewhere the project may be connected to: joined, with a folder of projects; the own one is refused. */
  async target(machine: string): Promise<PoolTarget> {
    if (machine === this.options.own()) throw fail('pool.ownMachine', {})
    const record = await this.foreign(machine)
    if (record.joinedAt === null) throw fail('machines.notJoined', {})
    const root = record.about?.root ?? null
    if (root === null) throw fail('machines.noRoot', {})
    return { id: record.id, name: record.name, root }
  }

  /** The folders group of a machine connected now. */
  folders(target: PoolTarget): MachineFolders {
    const peer = this.peers.get(target.id)
    if (peer === undefined || !this.hub.connected(target.id)) throw fail('pool.offline', { name: target.name })
    return peer.remote.services().folders
  }

  /** Shows a clone's progress on the machine until the returned function is called. */
  watchClone(machine: string, project: string, show: (progress: CloneProgress) => void): () => void {
    const key = `${machine}\0${project}`
    this.clones.set(key, show)
    return () => {
      if (this.clones.get(key) === show) this.clones.delete(key)
    }
  }

  /**
   * Puts the project's folder on the machine into its pool turned off, tells the machine the folder and briefs it, so
   * its packages install before the checks. Answers whether the row is new: Cancel takes back only such a row.
   */
  async place(target: PoolTarget, project: string, folder: string): Promise<boolean> {
    if (!insideRoot(folder, target.root)) throw fail('pool.outside', { folder, root: target.root })
    const { rows } = await this.options.db.query<{ enabled: boolean }>('select enabled from project_machines where project_id = $1 and machine_id = $2', [project, target.id])
    await this.options.db.query(
      `insert into project_machines (project_id, machine_id, enabled, folder) values ($1, $2, false, $3)
       on conflict (project_id, machine_id) do update set folder = $3`,
      [project, target.id, folder],
    )
    this.taken.get(target.id)?.delete(project)
    await this.hub.send(target.id, { type: ASSIGN_COMMAND, project, folder })
    this.options.log(`machines: machine ${target.id} (${target.name}) is given the folder ${folder} of project ${project}, to be checked`)
    await this.poolChanged(target.id)
    return rows.length === 0
  }

  /** Takes the machine out of the project's pool: Cancel of a connection that put it there. */
  async unplace(machine: string, project: string): Promise<void> {
    await this.options.db.query('delete from project_machines where project_id = $1 and machine_id = $2', [project, machine])
    await this.poolChanged(machine)
  }

  private async poolChanged(machine: string): Promise<void> {
    await this.refresh()
    if (this.hub.connected(machine)) await this.brief(machine)
    this.options.changed()
  }

  async close(): Promise<void> {
    this.hub.stop()
    await this.stopListening()
  }

  private async foreign(machine: string): Promise<MachineRecord> {
    const record = await this.options.store.machine(machine)
    if (record === undefined || record.id === this.options.own() || record.revokedAt !== null) throw fail('machines.unknown', {})
    return record
  }

  private async applyNow(): Promise<void> {
    const address = this.options.address()
    if (address === this.listeningFor && (address === null) === (this.server === undefined)) return
    if (address === null) {
      await this.stopListening()
      this.listeningFor = null
      return
    }
    // A new name changes nothing of the listener: the strings issued from now carry it.
    this.listeningFor = address
    if (this.server !== undefined) return
    const certificate = await this.options.certificate()
    const server = createHubServer({ hub: this.hub, certificate, log: this.options.log })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.options.port, () => {
        server.off('error', reject)
        resolve()
      })
    })
    server.on('error', (error) => this.options.log(`machines: the listener for machines: ${error.message}`))
    this.server = server
    this.options.log(`machines: listening for machines on port ${this.options.port}`)
  }

  private async stopListening(): Promise<void> {
    const server = this.server
    if (server === undefined) return
    this.server = undefined
    this.hub.stop()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    this.options.log('machines: the listener for machines is closed')
  }
}
