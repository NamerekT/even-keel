import type { AccountEntry } from '../../src/account/model.js'
import type { EvenKeelState, MachineAbout, MachineSignIn, MachineView } from '../../src/state.js'
import type { JoinRequest } from '../../src/jobs/model.js'
import { matchPath } from 'react-router'
import { CLAUDE } from '../../src/claude/name.js'
import { HUB_PLACE } from './accountAdd.js'
import { accountName } from './accountName.js'
import { paysPerToken } from './accounts.js'
import { MACHINE_PARAM } from './machineView.js'
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

/** The colours the hub's live machines have, the own one's too: a new machine is offered one none of them has. */
export function takenColors(state: Pick<EvenKeelState, 'machineNames' | 'machineColors'>, machines: MachineView[]): string[] {
  const gone = new Set(machines.filter((machine) => machine.revokedAt !== null || machine.joinedAt === null).map((machine) => machine.id))
  return Object.keys(state.machineNames ?? {}).flatMap((id) => {
    const color = state.machineColors?.[id]
    return gone.has(id) || color === undefined ? [] : [color]
  })
}

/**
 * What "Connect" sends (`machines/join`): the projects picked and not yet connected, in the hub's order, each with its
 * full folder on the machine when known. No clone flag: the folder decides (BTN-1298) — a clone into a free one, the
 * project's clone there taken as it is.
 */
export function joinRequests(projects: string[], chosen: Set<string>, folders: Record<string, string | null>): Array<Omit<JoinRequest, 'clone'>> {
  return projects
    .filter((project) => chosen.has(project))
    .map((project) => {
      const folder = folders[project] ?? null
      return { project, ...(folder !== null && { folder }) }
    })
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
 * the machine has; a missing one is not ok — the machine can neither sign in to that agent nor run its sessions. A
 * report names every agent it asked, `null` where no CLI is found as a launch looks for one.
 */
export function machineChecks(about: MachineAbout, hubAgents: string[]): MachineCheck[] {
  const major = Number(about.node.split('.')[0])
  const found = Object.keys(about.agents).filter((agent) => about.agents[agent] != null)
  const agents = [...new Set([...hubAgents, ...found])]
  return [
    { id: 'node', ok: major >= NODE_MAJOR, version: about.node },
    { id: 'git', ok: about.git !== null && about.gitUser, version: about.git, user: about.gitUser },
    ...agents.map((agent): MachineCheck => {
      const version = about.agents[agent] ?? null
      return { id: `agent:${agent}`, ok: version !== null, agent, version }
    }),
  ]
}

/**
 * The agents' CLIs of a machine's page (BTN-1307): those its report gives a version of and its panel does not miss,
 * and, of the agents the hub has accounts of, those it lacks. A report names every agent it asked, `null` where no CLI
 * is found as a launch looks for one (BTN-1502), so a name alone is no CLI; the page's `about` already carries the
 * panel's live versions.
 */
export function machineAgents(about: MachineAbout, missing: string[], hubAgents: string[]): { found: Array<{ agent: string; version: string }>; lacking: string[] } {
  const found = Object.entries(about.agents).flatMap(([agent, version]) => (version === null || missing.includes(agent) ? [] : [{ agent, version }]))
  return { found, lacking: [...new Set(hubAgents)].filter((agent) => !found.some((each) => each.agent === agent)) }
}

/**
 * The machine's accounts as the page's state has them; a machine just joined is not there until its first snapshot:
 * no accounts yet, and the CLIs its report misses.
 */
export function signInOf(machine: MachineView, signIns: MachineSignIn[] | undefined, hubAgents: string[]): MachineSignIn {
  const known = signIns?.find((each) => each.machine === machine.id)
  if (known !== undefined) return known
  const found = machine.about?.agents ?? {}
  return { machine: machine.id, name: machine.name, online: machine.online, accounts: [], login: null, missing: hubAgents.filter((agent) => found[agent] == null) }
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

/**
 * The hub's subscriptions the machine is not signed in to, as rows of its accounts page (BTN-1302); one whose gap is the
 * machine's own signed-out folder is left out — that folder's row there signs in again.
 */
export function hubGapsOn(accounts: AccountEntry[], machine: MachineSignIn): Array<MachineAccountRow & { gap: MachineGap }> {
  const signedOut = new Set(machine.accounts.filter((each) => !each.signedIn).map((each) => each.key))
  return machineAccounts(accounts, machine).flatMap((row) =>
    row.gap === null || (row.gap.account !== undefined && signedOut.has(row.gap.account)) ? [] : [{ ...row, gap: row.gap }])
}

/** Why a machine elsewhere lists no account: it posted no snapshot of its panel yet, or it posted one with none. */
export function machineAccountsEmpty(machine: string, signIns: MachineSignIn[] | undefined): 'waiting' | 'none' {
  return signIns?.some((each) => each.machine === machine) === true ? 'none' : 'waiting'
}

/**
 * The machine's accounts signed in by the hub's live state that the machine page's last read does not show signed in
 * (BTN-1520): the live state follows each snapshot of the machine, the page's own read lands a moment later.
 */
export function machineAccountsChecking(page: MachineSignIn['accounts'], live: MachineSignIn | undefined): MachineSignIn['accounts'] {
  const shown = new Set(page.filter((each) => each.signedIn).map((each) => `${each.agent} ${each.key}`))
  return (live?.accounts ?? []).filter((each) => each.signedIn && !shown.has(`${each.agent} ${each.key}`))
}

/** An agent a new account on a machine is of: those that sign in through a browser, with the method that does. */
export interface MachineAddChoice {
  agent: string
  method?: string
  /** The machine has no CLI of it. */
  missing: boolean
}

const BROWSER_SIGN_INS: ReadonlyArray<{ agent: string; method?: string }> = [{ agent: 'claude' }, { agent: 'codex' }, { agent: 'opencode', method: 'chatgpt' }]

/** The agents "Add account" offers on a machine elsewhere (BTN-1302), each one whose CLI the machine lacks off. */
export function machineAddChoices(machine: MachineSignIn | undefined): MachineAddChoice[] {
  return BROWSER_SIGN_INS.map((choice) => ({ ...choice, missing: machine?.missing.includes(choice.agent) === true }))
}

/**
 * The place "Add account" picks first (BTN-1308): the machine elsewhere of the page it opened over — its page
 * `/machines/<id>` or the header's `?machine=<id>` — while it is on the link; else the hub.
 */
export function defaultPlace(pathname: string, search: string, machines: MachineSignIn[] | undefined): string {
  const page = matchPath('/machines/:id', pathname)?.params.id ?? new URLSearchParams(search).get(MACHINE_PARAM)
  return machines?.some((each) => each.machine === page && each.online) === true ? page! : HUB_PLACE
}

/**
 * The hub's Claude subscriptions a long token on the machine can be of (BTN-1308): the machine ties its token folder
 * to a hub folder's claude.ai account, so only those not signed in there yet.
 */
export function tokenAccounts(accounts: AccountEntry[], machine: MachineSignIn): Array<{ account: string; who: string }> {
  return machineAccounts(accounts, machine).flatMap(({ entry, gap }) =>
    entry.agent !== CLAUDE || gap === null ? [] : [{ account: entry.key, who: entry.status?.email ?? entry.key }])
}

/**
 * The hub's Claude folders on a long token a machine can be signed in on as well, without pasting it (BTN-1501): not
 * refused, not past its last day, and not on the machine yet — `machines/sharedToken` names its folder there after the
 * hub's.
 */
export function sharedTokens(accounts: AccountEntry[], machine: MachineSignIn, now: number): Array<{ from: string; who: string }> {
  return accounts.flatMap((entry) => {
    const token = entry.longToken
    if (entry.agent !== CLAUDE || token === undefined || token.refusedAt !== undefined) return []
    if (token.until !== null && Date.parse(token.until) <= now) return []
    if (machine.accounts.some((each) => each.key === entry.key && each.agent === CLAUDE && each.longToken === true)) return []
    return [{ from: entry.key, who: accountName(entry, accounts) }]
  })
}
