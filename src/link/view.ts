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

/** A project's folder held by another machine (`docs/machines.md`, "The folder's mark"). */
export interface TakenFolder {
  project: string
  /** The machine the mark names, and its name: the hub's when it knows the machine, else the mark's. */
  machine: string
  name: string
}
