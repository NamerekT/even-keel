/** What the page reads of the machines elsewhere: types only, the page takes them through `src/state.ts`. */

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

/** A project's folder held by another machine (`docs/machines.md`, "The folder's mark"). */
export interface TakenFolder {
  project: string
  /** The machine the mark names, and its name: the hub's when it knows the machine, else the mark's. */
  machine: string
  name: string
}
