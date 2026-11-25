import type { HubHandlers } from '../link/hub.js'
import { ASSIGN_COMMAND, SNAPSHOT_TOO_LARGE_EVENT, TAKEN_EVENT, megabytes, type AssignPayload, type FolderTaken, type SnapshotTooLarge } from '../link/protocol.js'
import type { MachineProjectSettings } from '../link/view.js'
import { SELECTION_EVENT, type MachineSelection } from '../machine/config.js'
import { RemoteMachine } from '../machine/remote.js'
import { CLONE_PROGRESS_EVENT, type CloneTold } from '../machine/services.js'
import { fail } from '../notice/notice.js'
import { loadMail } from '../sessions/mailbox.js'
import { KEPT_WRITE_EVENT, type KeptWrite } from '../taskmcp/machine.js'
import { BriefSender } from './hub-brief.js'
import type { NetworkHost, NetworkPeers, Peer } from './machine-network-options.js'
import { settingsFromColumn } from './machine-settings.js'

/** The monitor's word that the machine has read its sessions: the hub catches it up with its brief. */
const SESSIONS_READ_EVENT = 'sessions.read'

/** Sends every machine online the brief that changed since the one it took. */
export async function catchUp(host: NetworkHost): Promise<void> {
  for (const machine of host.peers.keys()) if (host.hub.connected(machine)) await host.brief(machine)
}

/** What the hub's door does with a machine elsewhere's snapshot, events, requests and connection. */
export function hubHandlers(host: NetworkHost): HubHandlers {
  const { peers, log } = host.options
  const changed = (machine: string, online: boolean) => {
    if (online) host.wentOff.delete(machine)
    else host.wentOff.set(machine, Date.now())
    // A machine that comes online is read anew: one just joined is counted among the live ones at once, and the
    // system it reported at the handshake reaches its icon (BTN-1595).
    if (online) {
      void host.refresh().then(() => host.options.changed(), (error: unknown) => log(`machines: the machines could not be read anew: ${error instanceof Error ? error.message : String(error)}`))
    }
    host.options.changed()
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
      const peer = peerOf(host, machine, peers)
      const record = await host.options.store.machine(machine)
      peer.name = record?.name ?? machine
      peer.capacity = record?.capacity ?? 1
      if (record?.about != null) host.options.seen?.(machine, record.about)
      if (host.tooLarge.delete(machine)) log(`machines: machine ${machine} (${peer.name}) sends its state to the hub again`)
      peers.connected(machine)
      // A new connection may be a new process of the machine, which holds no brief yet.
      peer.briefs.forget()
      await peer.remote.handlers().snapshot(machine, snapshot)
      void host.brief(machine).then(() => host.options.briefed?.(machine))
      void handMail(host, machine, peer)
    },
    event: async (machine, event) => {
      if (event.type === SELECTION_EVENT) {
        // The hub's settings are its own machine's: a choice made on a machine elsewhere stays there.
        const selection = event.payload as MachineSelection
        log(`machines: machine ${machine} chose ${selection.kind} ${selection.value} for ${selection.provider}; the hub's settings are not changed by it`)
      } else if (event.type === TAKEN_EVENT) await refused(host, machine, event.payload as FolderTaken)
      else if (event.type === KEPT_WRITE_EVENT) await peers.write(machine, event.payload as KeptWrite)
      else if (event.type === SESSIONS_READ_EVENT) void host.brief(machine)
      else if (event.type === SNAPSHOT_TOO_LARGE_EVENT) await stateOverLimit(host, machine, event.payload as SnapshotTooLarge, peers)
      else if (event.type === CLONE_PROGRESS_EVENT) {
        const told = event.payload as CloneTold
        host.clones.get(`${machine}\0${told.project}`)?.(told.progress)
      } else await peerOf(host, machine, peers).remote.handlers().event(machine, event)
    },
    mcp: (machine, request) => peers.mcp(machine, request),
    hook: (machine, request) => peers.hook(machine, request),
    tally: (machine, rows) => peers.tally?.(machine, rows) ?? Promise.resolve({ taken: false }),
    credentials: (machine, project, urls) =>
      peers.credentials?.(machine, project, urls, host.clones.has(`${machine}\0${project}`)) ?? Promise.resolve({ credentials: [] }),
    git: (machine, project, request) => peers.git?.(machine, project, request) ?? { status: 404, contentType: 'text/plain', body: '' },
    online: (machine) => changed(machine, true),
    offline: (machine) => {
      host.peers.get(machine)?.remote.lost()
      changed(machine, false)
      peers.changed()
    },
  }
}

/**
 * The machine's snapshot does not go (BTN-1560): the page marks it, and the page's and the pool's calls waiting for it
 * are let go with the reason, as are new ones till a snapshot comes. Logged once, where the size changes little.
 */
async function stateOverLimit(host: NetworkHost, machine: string, told: SnapshotTooLarge, peers: NetworkPeers): Promise<void> {
  const name = (await host.options.store.machine(machine))?.name ?? machine
  if (!host.tooLarge.has(machine)) {
    host.options.log(`machines: machine ${machine} (${name}) cannot send its state to the hub: ${megabytes(told.bytes)} is over the link's limit; its largest parts: ${told.parts}`)
  }
  host.tooLarge.set(machine, { bytes: told.bytes, since: host.tooLarge.get(machine)?.since ?? Date.now() })
  peerOf(host, machine, peers).remote.refuseServices(() => fail('machines.tooLarge', { name }))
  host.options.changed()
}

/**
 * The machine's messages the hub keeps, handed back at each connection, which may be a new process with an empty
 * mailbox (BTN-1699): the waiting ones and the last delivered stay in its chat. The machine keeps what it already has.
 */
async function handMail(host: NetworkHost, machine: string, peer: Peer): Promise<void> {
  try {
    await peer.remote.services().records.restore({ mail: await loadMail(host.options.db, machine) })
  } catch (error) {
    host.options.log(`machines: machine ${machine} did not take back its messages: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function peerOf(host: NetworkHost, machine: string, peers: NetworkPeers): Peer {
  let peer = host.peers.get(machine)
  if (peer !== undefined) return peer
  const remote: RemoteMachine = new RemoteMachine({
    ...peers.remote(machine),
    send: (to, command) => host.hub.send(to, command),
    machine: () => machine,
    changed: () => peers.changed(),
    briefNow: () => host.brief(machine),
  })
  const made: Peer = { remote, port: remote.port(), capacity: 1, folders: {}, settings: {}, name: machine, briefs: new BriefSender(() => peers.brief(made.folders, made.settings, machine),(brief) => remote.tellBrief(brief)) }
  peer = made
  host.peers.set(machine, peer)
  return peer
}

async function refused(host: NetworkHost, machine: string, taken: FolderTaken): Promise<void> {
  if (await host.holds(machine, taken.project, taken)) {
    await host.hub.send(machine, { type: ASSIGN_COMMAND, project: taken.project, folder: taken.folder, payload: { takeOver: taken.machine } satisfies AssignPayload })
  }
}

/**
 * The machine's brief, its pool's folders read anew. A machine turned off keeps its projects there: their packages
 * install before its folder is checked, and a task it holds goes on; the chain pulls only from the ones turned on.
 */
export async function brief(host: NetworkHost, machine: string): Promise<void> {
  const peer = host.peers.get(machine)
  if (peer === undefined) return
  try {
    const root = (await host.options.store.machine(machine))?.about?.root ?? null
    const { rows } = await host.options.db.query<{ project_id: string; folder: string | null; settings: string | null }>(
      'select project_id, folder, settings from project_machines where machine_id = $1',
      [machine],
    )
    const folders: Record<string, string> = {}
    const settings: Record<string, MachineProjectSettings> = {}
    for (const row of rows) {
      const folder = host.folderOf(row.project_id, row.folder, root)
      if (folder === undefined) continue
      folders[row.project_id] = folder
      settings[row.project_id] = settingsFromColumn(row.settings)
    }
    peer.folders = folders
    peer.settings = settings
    await peer.briefs.send()
  } catch (error) {
    host.options.log(`machines: the brief for machine ${machine} was not taken: ${error instanceof Error ? error.message : String(error)}`)
  }
}
