import type { Server } from 'node:https'
import { networkInterfaces } from 'node:os'
import { dockerJoinOf, installCommandOf } from '../cli-install.js'
import { hubUrlOf, writtenAddressOf } from '../link/address.js'
import { colorOf } from '../link/colors.js'
import { createHubServer } from '../link/hub-server.js'
import type { Invite } from '../link/hub.js'
import type { AddressChoice, MachineInvite } from '../link/view.js'
import { fail } from '../notice/notice.js'
import type { NetworkHost } from './machine-network-options.js'

const LOOPBACK = /^(127\.|::1$|localhost$)/
const WILDCARD = new Set(['0.0.0.0', '::', ''])
/** The port a proxy that ends TLS takes HTTPS at when the address names none. */
const HTTPS_PORT = 443

/** The hub's door for machines: the HTTPS listener by "Hub address for machines", the addresses offered and the connection strings. */
export class HubDoor {
  private server: Server | undefined
  private listeningFor: string | null = null
  private applying: Promise<void> = Promise.resolve()

  constructor(private readonly host: NetworkHost) {}

  /** Opens or closes the listener by the setting as it is now; called at the start and at every change of the settings. */
  apply(): Promise<void> {
    this.applying = this.applying.then(() => this.host.refresh()).then(() => this.applyNow()).catch((error: unknown) => {
      this.host.options.log(`machines: the listener for machines did not start: ${error instanceof Error ? error.message : String(error)}`)
    })
    return this.applying
  }

  /** The names the page offers for the setting, each once. */
  addresses(): AddressChoice[] {
    const choices: AddressChoice[] = this.host.options.allowedHosts().map((address) => ({ address, from: 'allowedHosts' }))
    for (const [adapter, entries] of Object.entries(this.host.options.inContainer ? {} : networkInterfaces())) {
      for (const entry of entries ?? []) {
        if (entry.internal || LOOPBACK.test(entry.address) || entry.address.startsWith('169.254.') || /^fe80:/i.test(entry.address)) continue
        choices.push({ address: entry.family === 'IPv6' ? `[${entry.address}]` : entry.address, from: 'adapter', adapter })
      }
    }
    const host = this.host.options.serviceHost.trim().toLowerCase()
    if (!WILDCARD.has(host) && !LOOPBACK.test(host)) choices.push({ address: host, from: 'service' })
    return choices.filter((choice, index) => choices.findIndex((other) => other.address === choice.address) === index)
  }

  /**
   * A connection string for a machine to join with, and the one command that installs the machine with it; the strings
   * issued before and never joined with stop working. `given` — the address the window chose (BTN-1056): it becomes
   * "Hub address for machines" first. No name — the machine is named by its host when it joins. `proxied` — the
   * address is a proxy that ends TLS with a public authority's certificate (BTN-1286): the string pins no fingerprint,
   * and an address without a port means 443, not the machines' port.
   */
  async invite(name: string, given?: string, color?: string, proxied = false): Promise<Invite & Pick<MachineInvite, 'command' | 'docker' | 'byAddress'>> {
    const painted = color === undefined ? undefined : colorOf(color)
    if (color !== undefined && painted === undefined) throw fail('request.required', { field: 'color' })
    const chosen = given?.trim().toLowerCase()
    if (chosen && chosen !== this.host.options.address()) {
      this.host.options.saveAddress?.(chosen)
      await this.apply()
    }
    const address = this.host.options.address()
    const url = address === null ? undefined : hubUrlOf(address, proxied ? HTTPS_PORT : this.host.options.port)
    if (url === undefined) throw fail('machines.noAddress', {})
    const fingerprint = proxied ? '' : (await this.host.options.certificate()).fingerprint
    const invite = await this.host.hub.invite(name.trim(), url, fingerprint)
    if (painted !== undefined) {
      await this.host.options.store.setColor(invite.machine, painted)
      await this.host.refresh()
    }
    this.host.options.log(`machines: a connection string for "${name.trim() || '(its host)'}" was issued, good until ${new Date(invite.expiresAt).toISOString()}`)
    const written = writtenAddressOf(url)
    return {
      ...invite,
      command: installCommandOf(this.host.options.version, invite.line),
      docker: dockerJoinOf(this.host.options.version, invite.line),
      byAddress: { command: installCommandOf(this.host.options.version, written), docker: dockerJoinOf(this.host.options.version, written) },
    }
  }

  private async applyNow(): Promise<void> {
    const address = this.host.options.address()
    if (address === this.listeningFor && (address === null) === (this.server === undefined)) return
    if (address === null) {
      await this.stopListening()
      this.listeningFor = null
      return
    }
    // A new name changes nothing of the listener: the strings issued from now carry it.
    this.listeningFor = address
    if (this.server !== undefined) return
    const certificate = await this.host.options.certificate()
    const { requests } = this.host.options
    const server = createHubServer({ hub: this.host.hub, certificate, log: this.host.options.log, ...(requests !== undefined && { requests }) })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.host.options.port, () => {
        server.off('error', reject)
        resolve()
      })
    })
    server.on('error', (error) => this.host.options.log(`machines: the listener for machines: ${error.message}`))
    this.server = server
    this.host.options.log(`machines: listening for machines on port ${this.host.options.port}`)
  }

  async stopListening(): Promise<void> {
    const server = this.server
    if (server === undefined) return
    this.server = undefined
    this.host.hub.stop()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    this.host.options.log('machines: the listener for machines is closed')
  }
}
