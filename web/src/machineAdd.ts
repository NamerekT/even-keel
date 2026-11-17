import type { AccountEntry } from '../../src/account/model.js'
import type { MachineAbout, MachineSignIn, MachineView } from '../../src/state.js'
import { paysPerToken } from './accounts.js'
import { machineGaps, machineTokens, type MachineGap } from './machineSignIn.js'

const KEY = 'addMachine'

/**
 * Where the window that adds a machine stands (BTN-1056), from the address: `new` — the address step, a machine's id
 * — the step of a machine that joined (the toast and a reload open it there); `null` — closed.
 */
export function addMachineOf(search: URLSearchParams): string | null {
  const value = search.get(KEY)
  return value === null || value === '' ? null : value
}

export function withAddMachine(search: string, at: string | null): string {
  const params = new URLSearchParams(search)
  if (at === null) params.delete(KEY)
  else params.set(KEY, at)
  const text = params.toString()
  return text === '' ? '' : `?${text}`
}

/** The machine the string was issued for, once it joined with it. */
export function joinedMachine(machines: MachineView[], machine: string): MachineView | undefined {
  return machines.find((each) => each.id === machine && each.joinedAt !== null && each.revokedAt === null)
}

const PLATFORMS: Record<string, string> = { linux: 'Linux', win32: 'Windows', darwin: 'macOS' }

/** `process.platform` and the release, as a person names the system. */
export function osLabel(os: string): string {
  const [platform = '', ...release] = os.split(' ')
  const name = PLATFORMS[platform]
  return name === undefined ? os : [name, ...release].join(' ')
}

export type MachineCheck =
  | { id: 'node'; ok: boolean; version: string }
  | { id: 'git'; ok: boolean; version: string | null; user: boolean }
  | { id: `agent:${string}`; ok: boolean; agent: string; version: string | null }

const NODE_MAJOR = 24

/**
 * What the machine reported, as checks: Node, git with its user, and the CLI of each agent the hub has accounts of or
 * the machine has; a missing one is not ok — the hub sends that agent's tasks elsewhere.
 */
export function machineChecks(about: MachineAbout, hubAgents: string[]): MachineCheck[] {
  const major = Number(about.node.split('.')[0])
  const agents = [...new Set([...hubAgents, ...Object.keys(about.agents)])]
  return [
    { id: 'node', ok: major >= NODE_MAJOR, version: about.node },
    { id: 'git', ok: about.git !== null && about.gitUser, version: about.git, user: about.gitUser },
    ...agents.map((agent): MachineCheck => {
      const found = Object.hasOwn(about.agents, agent)
      return { id: `agent:${agent}`, ok: found, agent, version: found ? about.agents[agent]! : null }
    }),
  ]
}

/**
 * The machine's accounts as the page's state has them; a machine just joined is not there until its first snapshot:
 * no accounts yet, and the CLIs its report misses.
 */
export function signInOf(machine: MachineView, signIns: MachineSignIn[] | undefined, hubAgents: string[]): MachineSignIn {
  const known = signIns?.find((each) => each.machine === machine.id)
  if (known !== undefined) return known
  const found = machine.about?.agents ?? {}
  return { machine: machine.id, name: machine.name, online: machine.online, accounts: [], login: null, missing: hubAgents.filter((agent) => !Object.hasOwn(found, agent)) }
}

export interface MachineAccountRow {
  entry: AccountEntry
  /** `null` — signed in on the machine. */
  gap: MachineGap | null
  /** Signed in there only on a long token (BTN-1002): no Remote Control. */
  token?: true
}

/** Each hub subscription signed in through a browser, once per agent and e-mail, with its sign-in on the machine. */
export function machineAccounts(accounts: AccountEntry[], machine: MachineSignIn): MachineAccountRow[] {
  const seen = new Set<string>()
  return accounts.flatMap((entry) => {
    const email = entry.status?.loggedIn === true ? entry.status.email : null
    if (email === null || paysPerToken(entry) || entry.longToken !== undefined) return []
    const id = `${entry.agent} ${email.toLowerCase()}`
    if (seen.has(id)) return []
    seen.add(id)
    return [{ entry, gap: machineGaps(entry, [machine])[0] ?? null, ...(machineTokens(entry, [machine]).length > 0 && { token: true as const }) }]
  })
}
