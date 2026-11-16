import type { Server } from 'node:https'
import { networkInterfaces } from 'node:os'
import { basename, posix, win32 } from 'node:path'
import { fail } from '../notice/notice.js'
import { hubUrlOf } from '../link/address.js'
import type { HubCertificate } from '../link/cert.js'
import { createHubServer } from '../link/hub-server.js'
import type { HubStore, MachineRecord } from '../link/hub-store.js'
import { HubEnd, type Invite } from '../link/hub.js'
import { ASSIGN_COMMAND, HEARTBEAT_MS } from '../link/protocol.js'
import type { AddressChoice, MachineView } from '../link/view.js'
import type { Queryable } from '../storage/database.js'

export type { AddressChoice, MachineView }

export interface MachineNetworkOptions {
  db: Queryable
  store: HubStore
  certificate: () => Promise<HubCertificate>
  /** The hub's own machine: served through the local link, never over the network. */
  own: () => string
  /** "Hub address for machines", read live. */
  address: () => string | null
  port: number
  /** The hub's folder of a project; `undefined` — no such project. */
  repoOf: (project: string) => string | undefined
  allowedHosts: () => string[]
  /** `EVEN_KEEL_HOST`: offered when it is no loopback or wildcard address. */
  serviceHost: string
  /** A machine joined, connected or went away: the page asks for the list again. */
  changed: () => void
  log: (line: string) => void
}

const LOOPBACK = /^(127\.|::1$|localhost$)/
const WILDCARD = new Set(['0.0.0.0', '::', ''])

/** The folder a project gets inside a machine's folder of projects: the hub's folder name, in the machine's way of writing paths. */
export function folderUnder(root: string, repo: string): string {
  const name = basename(repo.replace(/[\\/]+$/, '').replaceAll('\\', '/'))
  return (root.includes('\\') || /^[A-Za-z]:/.test(root) ? win32 : posix).join(root, name)
}

/**
 * The hub's door for machines elsewhere (BTN-1242): a `HubEnd` of its own over the hub's store, serving every machine
 * but the hub's own, and the HTTPS listener behind it, open only while "Hub address for machines" is set. Until the
 * machine's process (BTN-1247) its machines' events stay in their outboxes: the hub takes their handshake, their
 * report and their snapshot, and sends them only the assignment of a project.
 */
export class MachineNetwork {
  readonly hub: HubEnd
  private server: Server | undefined
  private listeningFor: string | null = null
  private applying: Promise<void> = Promise.resolve()

  constructor(private readonly options: MachineNetworkOptions) {
    this.hub = new HubEnd({
      store: options.store,
      admits: (machine) => machine !== options.own(),
      heartbeatMs: HEARTBEAT_MS,
      log: options.log,
      handlers: {
        snapshot: () => {},
        event: () => {
          throw new Error('the events of a machine elsewhere are taken once it runs on its own (BTN-1247)')
        },
        online: () => options.changed(),
        offline: () => options.changed(),
      },
    })
  }

  /** Opens or closes the listener by the setting as it is now; called at the start and at every change of the settings. */
  apply(): Promise<void> {
    this.applying = this.applying.then(() => this.applyNow()).catch((error: unknown) => {
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

  /** A connection string for a machine to join with; the strings issued before and never joined with stop working. */
  async invite(name: string): Promise<Invite> {
    const address = this.options.address()
    const url = address === null ? undefined : hubUrlOf(address, this.options.port)
    if (url === undefined) throw fail('machines.noAddress', {})
    const { fingerprint } = await this.options.certificate()
    const invite = await this.hub.invite(name.trim() || 'Machine', url, fingerprint)
    this.options.log(`machines: a connection string for "${name.trim()}" was issued, good until ${new Date(invite.expiresAt).toISOString()}`)
    return invite
  }

  async revoke(machine: string): Promise<void> {
    const record = await this.foreign(machine)
    await this.hub.revoke(record.id)
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
    for (const [project, repo] of repos) {
      await this.options.db.query(
        'insert into project_machines (project_id, machine_id) values ($1, $2) on conflict (project_id, machine_id) do update set enabled = true',
        [project, record.id],
      )
      await this.hub.send(record.id, { type: ASSIGN_COMMAND, project, folder: folderUnder(root, repo!) })
    }
    this.options.log(`machines: machine ${record.id} (${record.name}) was given ${projects.length} project(s)`)
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
