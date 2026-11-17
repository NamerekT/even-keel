/** What the page reads of the machines elsewhere: types only, the page takes them through `src/state.ts`. */

import type { AccountLogin } from '../account/model.js'

/** What a machine tells about itself when it joins and at every handshake: for the hub's page (BTN-1056, BTN-993). */
export interface MachineAbout {
  host: string
  /** `process.platform` and the system's release, such as `linux 6.8.0`. */
  os: string
  evenKeel: string
  node: string
  /** `null` — git does not start there. */
  git: string | null
  /** The agent CLIs found on the machine, by the agent's name, with the version each printed (`null` — it did not say). */
  agents: Record<string, string | null>
  /** Whether git there has `user.name` and `user.email`: without them a session's commit fails. */
  gitUser: boolean
  /** The folder of projects the machine agreed to (`docs/machines.md`, "What a command may touch"); `null` — none. */
  root: string | null
}

/** A name the page offers for "Hub address for machines": one of the page's names, a network card's address, the service's own. */
export interface AddressChoice {
  address: string
  from: 'allowedHosts' | 'adapter' | 'service'
  /** The network card's name, for `adapter`. */
  adapter?: string
}

/** The answer of `machines/invite`: the string, the machine it was issued for, until when it holds and the install command. */
export interface MachineInvite {
  line: string
  machine: string
  expiresAt: number
  command: string
}

/** A machine of the network as the page sees it (BTN-1242; its window is BTN-1056). */
export interface MachineView {
  id: string
  name: string
  createdAt: number
  revokedAt: number | null
  /** Until when its connection string can be joined with, while it has not joined. */
  inviteExpires: number | null
  joinedAt: number | null
  host: string | null
  about: MachineAbout | null
  online: boolean
  /** The projects whose pool has it. */
  projects: string[]
  /** The projects whose folder there another machine's mark holds, by that machine: the page offers to take it over. */
  taken: TakenFolder[]
}

/**
 * A machine as the header's machines panel shows it (BTN-1051): the own one and every joined one not revoked. What it
 * runs and what it takes next the page reads from the chain; this is what only the hub knows.
 */
export interface MachineCard {
  id: string
  name: string
  color: string
  own: boolean
  online: boolean
  /** Since when it is off the link, as this hub saw it go; `null` — online, or not seen since the hub started. */
  offlineSince: number | null
  /** Its git has a user name and e-mail: without them a session's commit fails, so it takes no task. `null` — not told yet. */
  gitUser: boolean | null
  /** Even Keel's version its report names, where it is not the hub's: it takes no new task (BTN-994). */
  otherVersion?: string
  /** The agents it has a signed-in account of. */
  agents: string[]
  /** By agent, when the first of its accounts frees, where every signed-in account of that agent there is at a limit. */
  limitedUntil: Record<string, string>
  /** The projects of its pool: whether it takes their tasks and whether their packages hold them there. */
  projects: Array<{ project: string; enabled: boolean; packagesBlocked: boolean }>
  /** Its accounts panel with the limits it read, for the header and the accounts page of its view (BTN-1279); empty before its first snapshot. */
  accounts: MachineCardAccount[]
  /** The account folder its panel names as the launch choice; `null` — none, or not told yet. */
  active: string | null
}

/** An account of a machine's card: no token and no credentials. */
export interface MachineCardAccount extends MachineAccount {
  /** The name the person gave it on that machine. */
  name: string | null
  limits: import('../limits/model.js').RateLimits | null
}

/** A machine of a project's pool, as the section "Machines" of its settings shows it (BTN-1271). */
export interface PoolMachine {
  id: string
  name: string
  /** The hub's own machine: its folder is the project's repository and it needs no connecting. */
  own: boolean
  online: boolean
  /** The project's folder there. */
  folder: string
  /** The machine takes the project's tasks (`project_machines.enabled`). */
  enabled: boolean
}

/** The section "Machines" of a project: its pool, and the machines elsewhere that may still be connected to it. */
export interface ProjectPool {
  machines: PoolMachine[]
  /** Joined machines elsewhere not in the pool, with the folder a connection names by default. */
  others: Array<{ id: string; name: string; own: boolean; online: boolean; folder: string | null }>
}

/**
 * A machine elsewhere's accounts and its sign-in under way, from its mirror (BTN-1245, `docs/machines.md`, "Signing in on
 * a machine"): no token and no credentials, only what its accounts panel shows.
 */
export interface MachineSignIn {
  machine: string
  name: string
  online: boolean
  accounts: MachineAccount[]
  login: MachineLogin | null
  /** The agents whose CLI the machine does not find: no sign-in of theirs is offered there. */
  missing: string[]
}

export interface MachineAccount {
  key: string
  agent: string
  /** The e-mail its folder is signed in as, else that of the hub's account its long token is of, else the last one. */
  email: string | null
  signedIn: boolean
  /** Signed in with a long token (BTN-1002): no Remote Control there. */
  longToken?: true
}

/** The machine's sign-in under way as its panel shows it (`AccountLogin`); the code the person types goes back through the hub. */
export type MachineLogin = Pick<AccountLogin, 'agent' | 'method' | 'target' | 'startedAt' | 'urls' | 'deviceCode' | 'output' | 'error' | 'codeSent'>

/** The page of one machine, the own one or one elsewhere (BTN-1272, `docs/machines.md`, "The machine's page"). */
export interface MachinePage {
  id: string
  name: string
  /** The hub's own machine: always on the link, its capacity is `parallel`, it cannot be revoked. */
  own: boolean
  online: boolean
  joinedAt: number | null
  /** Its report; the own machine's is read when its page is first opened. `null` — it has not told one yet. */
  about: MachineAbout | null
  /** The hub's version of Even Keel: a machine elsewhere whose report names another goes on with its tasks and takes no new ones (BTN-994). */
  hubVersion: string
  /** Its colour, its own or the palette's (`picked` says which), and the palette the page offers. */
  color: string
  picked: boolean
  palette: string[]
  /** How many of the hub's tasks it runs at once. */
  capacity: number
  projects: MachineProject[]
  accounts: Array<MachineAccount & { limits: import('../limits/model.js').RateLimits | null }>
  /** The agents whose CLI the machine does not find. */
  missing: string[]
  /** Its sessions not finished. */
  sessions: Array<Pick<import('../state.js').SessionView, 'task' | 'sessionId' | 'agent' | 'model' | 'lamp' | 'cwd'>>
  taken: TakenFolder[]
}

/** A project of a machine's pool as its page shows it: the folder there, whether it takes the tasks, its packages. */
export interface MachineProject {
  project: string
  folder: string
  enabled: boolean
  /** The project's packages are not ready there: the chain takes none of its tasks on the machine. */
  packagesBlocked: boolean
  packagesPause: import('../notice/notice.js').Notice | null
}

/** A project's folder held by another machine (`docs/machines.md`, "The folder's mark"). */
export interface TakenFolder {
  project: string
  /** The machine the mark names, and its name: the hub's when it knows the machine, else the mark's. */
  machine: string
  name: string
}
