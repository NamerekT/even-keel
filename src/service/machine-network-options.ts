import { basename, posix, win32 } from 'node:path'
import type { HubLongToken } from '../account/longToken.js'
import type { LaunchEntry } from '../chain/model.js'
import type { TokenAccountOf } from '../account/model.js'
import type { HubCertificate } from '../link/cert.js'
import type { CloneProgress } from '../git/clone-progress.js'
import type { HubStore, MachineRecord } from '../link/hub-store.js'
import type { HubEnd } from '../link/hub.js'
import type { JoinRequests } from '../link/join-requests.js'
import type { CredentialsAnswer, GitAnswer, GitRequest, HookAnswer, HookRequest, McpAnswer, McpRequest, TallyAnswer } from '../link/protocol.js'
import type { MachineAbout, MachineProjectSettings, PoolServer, StateTooLarge, TakenFolder } from '../link/view.js'
import type { HubBrief } from '../machine/brief.js'
import type { RemoteDeps, RemoteMachine } from '../machine/remote.js'
import type { MachinePort } from '../machine/port.js'
import { isInside } from '../paths.js'
import type { ProjectSettings } from '../state.js'
import type { Queryable } from '../storage/database.js'
import type { KeptWrite } from '../taskmcp/machine.js'
import type { BriefSender } from './hub-brief.js'

/**
 * What the hub gives a machine elsewhere past its door (BTN-1247): its own mirror, its brief, the plan of its account
 * limits and the hub's MCP servers. Without it the machine's events stay in its outbox.
 */
export interface NetworkPeers {
  /** The hub's port of the machine, but how it sends and whom it stands for. */
  remote: (machine: string) => Omit<RemoteDeps, 'send' | 'machine' | 'catchUp' | 'changed' | 'briefNow'>
  /** The hub's brief for the machine, whose projects are those of its pool, each in its folder there with its own values. */
  brief: (folders: Record<string, string>, settings: Record<string, MachineProjectSettings>, machine: string) => HubBrief
  /** A machine's facts or connection changed: the limits are planned again. */
  changed: () => void
  /** A new connection of the machine: what it was told before is not known to hold. */
  connected: (machine: string) => void
  mcp: (machine: string, request: McpRequest) => Promise<McpAnswer>
  /** A hook of a session on the machine asking the hub's page (BTN-1260). */
  hook: (machine: string, request: HookRequest) => Promise<HookAnswer>
  /** Rows of the machine's own Tally collector (BTN-1280); absent — none are taken. */
  tally?: (machine: string, rows: unknown) => Promise<TallyAnswer>
  /** The tokens of a project's remotes for one git call of the machine (BTN-1541); `cloning` — a clone of the hub's in flight. Absent — none. */
  credentials?: (machine: string, project: string, urls: string[], cloning: boolean) => Promise<CredentialsAnswer>
  /** One git request of the machine to a project's memory repository (BTN-1648). Absent — 404. */
  git?: (machine: string, project: string, request: GitRequest) => Promise<GitAnswer>
  write: (machine: string, write: KeptWrite) => Promise<void>
  /** The hub's journal entries of the machine, handed back at its connection (`machineJournal`, BTN-1803); absent — none. */
  launches?: (machine: string) => LaunchEntry[]
}

export interface Peer {
  remote: RemoteMachine
  /** The chain's port of the machine (`MachinePool`). */
  port: MachinePort
  /** How many of the hub's tasks it runs at once, read at each snapshot. */
  capacity: number
  briefs: BriefSender
  /** The folders of the machine's pool, read before each brief. */
  folders: Record<string, string>
  /** Its own values in each project of its pool (BTN-994), read with the folders. */
  settings: Record<string, MachineProjectSettings>
  /** The hub's name of the machine, read at each snapshot: the page's state is built without a query. */
  name: string
}

export interface MachineNetworkOptions {
  db: Queryable
  store: HubStore
  certificate: () => Promise<HubCertificate>
  /** The machines asking to join by the address (BTN-1620), taken at the same door; none — only connection strings. */
  requests?: Pick<JoinRequests, 'ask' | 'answer'>
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
  /** The hub runs in a container (BTN-1440): its network cards' addresses are the container's, not offered. */
  inContainer?: boolean
  /** The hub's version of Even Keel: a machine installs the same one. */
  version: string
  /** The commit of the checkout the hub runs from, as it started (BTN-1275): a machine from a checkout moves to it. */
  commit?: string
  /** A machine joined, connected or went away: the page asks for the list again. */
  changed: () => void
  /** A machine elsewhere's snapshot came with the report of its handshake: its build is compared with the hub's (BTN-1609). */
  seen?: (machine: string, about: MachineAbout) => void
  /** The projects' machines were read anew or one was revoked: a width above them is cut (BTN-1571, `machinesIn`). */
  poolCounted?: () => void
  /** The project's settings, for the commands after a green main each machine of the pool runs. */
  projectSettings?: (project: string) => Pick<ProjectSettings, 'beforeStart' | 'check' | 'afterGreen'> | undefined
  /** The stdio servers of the project's packages here, which a machine elsewhere may run with a command of its own. */
  servers?: (project: string) => PoolServer[]
  /** A machine elsewhere connected and was given its brief: what it missed off the link may run there now. */
  briefed?: (machine: string) => void
  peers?: NetworkPeers
  /** The own machine takes the project's folder over from `owner`'s mark. */
  takeOverOwn?: (project: string, owner: string) => Promise<void>
  /** The claude.ai account of a hub's Claude folder with a full sign-in; `undefined` — none known (BTN-1002). */
  hubAccount?: (key: string) => TokenAccountOf | undefined
  /** The long token of a hub's Claude folder with whom it was said to be of; `undefined` — the folder runs on none (BTN-1501). */
  hubLongToken?: (key: string) => HubLongToken | undefined
  /** Whether a machine on the link polls the claude.ai account; absent — the sign-ins carry no `sessionsOnly` (BTN-1266). */
  polled?: (account: string) => boolean
  /** The account's long-token windows differ from its full sign-in's poll; absent — no `limitsDiffer` (BTN-1267). */
  differs?: (account: string) => boolean
  log: (line: string) => void
}

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

/**
 * What the parts of `MachineNetwork` in other files (the pool, the briefs, the accounts on a machine, the door) need of
 * it: its hub end, its maps by machine and a few of its own moves.
 */
export interface NetworkHost {
  readonly options: MachineNetworkOptions
  readonly hub: HubEnd
  readonly peers: Map<string, Peer>
  readonly taken: Map<string, Map<string, TakenFolder>>
  readonly clones: Map<string, (progress: CloneProgress) => void>
  readonly wentOff: Map<string, number>
  readonly tooLarge: Map<string, StateTooLarge>
  refresh(): Promise<void>
  foreign(machine: string): Promise<MachineRecord>
  folderOf(project: string, folder: string | null, root: string | null): string | undefined
  folderOn(machine: string, project: string, root: string | null): Promise<string | undefined>
  holds(machine: string, project: string, owner: { machine: string; name: string } | undefined): Promise<boolean>
  brief(machine: string): Promise<void>
}

/** A machine of a project's pool as the connect job finds it: joined, with a folder of projects. */
export interface PoolTarget {
  id: string
  name: string
  root: string
}
