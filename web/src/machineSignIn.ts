import type { AccountEntry } from '../../src/account/model.js'
import { CLAUDE } from '../../src/claude/name.js'
import { hubFolderOf } from '../../src/account/same-account.js'
import type { MachineAccount, MachineSignIn } from '../../src/state.js'
import { sameChoices } from './accountAdd.js'
import { paysPerToken, type Access } from './accounts.js'
import type { Send } from './layout/accountParts.js'

/**
 * How a machine's signed-out folder signs in again (BTN-1585): a key or a cloud and a long token get no browser sign-in,
 * which would put some subscription into a key's folder; a folder known by an e-mail is a subscription's; one neither
 * the machine nor the hub's folder of the same key tells about is `unknown`, and its "Sign in" asks the way first.
 */
export type FolderWay = 'subscription' | 'key' | 'token' | 'unknown'

export function folderWay(account: Pick<MachineAccount, 'key' | 'agent' | 'email' | 'longToken' | 'paysPerToken'>, hub: readonly AccountEntry[]): FolderWay {
  if (account.paysPerToken === true) return 'key'
  if (account.longToken === true) return 'token'
  const same = hub.find((entry) => entry.agent === account.agent && entry.key === account.key)
  if (same !== undefined && paysPerToken(same)) return 'key'
  if (same?.longToken !== undefined) return 'token'
  return account.email === null ? 'unknown' : 'subscription'
}

/** Whose sign-in a browser one of the agent is: Claude's subscription, ChatGPT, GitHub, OpenCode's own. */
export function loginAccess(agent: string, method?: string): Access {
  if (agent === CLAUDE) return 'claudeSubscription'
  if (agent === 'copilot') return 'github'
  if (agent === 'opencode' && method !== 'chatgpt') return 'zen'
  return 'chatgpt'
}

/**
 * What the window of a sign-in on a machine names besides the machine (BTN-1585): whose sign-in it is, the folder there
 * and its e-mail (`null` each — a new account), and whether the chain's tasks there take it: the machine's own launch
 * account, or the hub's folder of the same e-mail that a project's sessions run on.
 */
export function machineLoginFacts(machine: MachineSignIn, hub: readonly AccountEntry[]): { access: Access; folder: string | null; email: string | null; used: boolean } | null {
  const login = machine.login
  if (login === null) return null
  const access = loginAccess(login.agent, login.method)
  if (login.target === null) return { access, folder: null, email: null, used: false }
  const email = machine.accounts.find((each) => each.key === login.target)?.email ?? null
  const used = machine.active === login.target || (hubFolderOf(hub, login.agent, email)?.projects.length ?? 0) > 0
  return { access, folder: login.target, email, used }
}

/** A machine elsewhere where a hub account is not signed in (BTN-1245): the line under the account and its button. */
export interface MachineGap {
  machine: string
  name: string
  online: boolean
  /** The machine's own folder of the account, signed out: signed in again there; absent — a new account there. */
  account?: string
  /** The machine's CLI folder that is signed in as the account but not added (BTN-1568): "Use it" adds it, with no sign-in. */
  global?: string
  /** The machine has no CLI of the account's agent: nothing to sign in with. */
  noCli: boolean
}

/** What a gap's button sends: the CLI folder not added is added as it is, else a sign-in on the machine. */
export function gapCommand(agent: string, gap: MachineGap): [string, Record<string, unknown>] {
  if (gap.global !== undefined) return ['machines/useGlobal', { machine: gap.machine, agent }]
  return ['machines/login', { machine: gap.machine, agent, ...(gap.account !== undefined && { account: gap.account }) }]
}

export const sameEmail = (a: string | null, b: string | null): boolean => a !== null && b !== null && a.toLowerCase() === b.toLowerCase()

/**
 * The machines elsewhere where the hub's account is not signed in. Only a subscription the person signs in to in a
 * browser counts, known by its e-mail: a key, a cloud or a long token is not carried to a machine this way.
 */
export function machineGaps(entry: AccountEntry, machines: MachineSignIn[] | undefined): MachineGap[] {
  const email = entry.status?.loggedIn === true ? entry.status.email : null
  if (email === null || paysPerToken(entry) || entry.longToken !== undefined) return []
  return (machines ?? []).flatMap((machine) => {
    const own = machine.accounts.filter((each) => each.agent === entry.agent && sameEmail(each.email, email))
    if (own.some((each) => each.signedIn)) return []
    const folder = own[0]?.key ?? machine.accounts.find((each) => each.agent === entry.agent && each.key === entry.key)?.key
    const global = machine.globals?.find((each) => each.agent === entry.agent && sameEmail(each.email, email))?.key
    return [{
      machine: machine.machine,
      name: machine.name,
      online: machine.online,
      ...(folder !== undefined && { account: folder }),
      ...(global !== undefined && { global }),
      noCli: machine.missing.includes(entry.agent),
    }]
  })
}

/**
 * The machines elsewhere that run the hub's account only on a long token (BTN-1002): no Remote Control there. A machine
 * with a full sign-in of the account as well is not named. `sessionsOnly` — no machine polls the account, the hub's
 * folder being signed out too, so the limits there come only from its sessions (BTN-1266).
 */
export function machineTokens(entry: AccountEntry, machines: MachineSignIn[] | undefined): Array<{ machine: string; name: string; sessionsOnly: boolean }> {
  const email = entry.status?.email ?? entry.lastEmail ?? null
  if (email === null || entry.longToken !== undefined) return []
  return (machines ?? []).flatMap((machine) => {
    const own = machine.accounts.filter((each) => each.agent === entry.agent && each.signedIn && sameEmail(each.email, email))
    if (own.length === 0 || !own.every((each) => each.longToken === true)) return []
    return [{ machine: machine.machine, name: machine.name, sessionsOnly: own.every((each) => each.sessionsOnly === true) }]
  })
}

/** How a hub account stands on a machine elsewhere (BTN-1309): signed in, on a long token only, or its folder there signed out. */
export type MachineMarkKind = 'in' | 'token' | 'out'

/** A machine of the accounts page's "Machines" column. */
export interface MachineMark {
  machine: string
  name: string
  online: boolean
  kind: MachineMarkKind
  /** The machine's signed-out folder of the account: `machines/login` signs it in again there. */
  account?: string
  /** On a long token whose account no machine polls (BTN-1266). */
  sessionsOnly: boolean
}

/**
 * The machines elsewhere the hub's account is on, known by its e-mail: a machine where it never signed in is not named,
 * a sign-in there goes through "Add account". A hub long token beside a full sign-in of the same e-mail names none, so
 * the machines show once, under the full one; a key or a cloud is on no machine this way.
 */
export function machineMarks(entry: AccountEntry, accounts: AccountEntry[], machines: MachineSignIn[] | undefined): MachineMark[] {
  const email = entry.status?.email ?? entry.lastEmail ?? null
  if (email === null || paysPerToken(entry)) return []
  if (entry.longToken !== undefined && accounts.some((each) => each !== entry && each.agent === entry.agent && each.longToken === undefined &&
    sameEmail(each.status?.email ?? each.lastEmail ?? null, email))) return []
  return (machines ?? []).flatMap((machine): MachineMark[] => {
    const own = machine.accounts.filter((each) => each.agent === entry.agent &&
      (sameEmail(each.email, email) || (each.email === null && !each.signedIn && each.key === entry.key)))
    if (own.length === 0) return []
    const base = { machine: machine.machine, name: machine.name, online: machine.online }
    const signed = own.filter((each) => each.signedIn)
    if (signed.length === 0) return [{ ...base, kind: 'out', account: own[0]!.key, sessionsOnly: false }]
    const token = signed.every((each) => each.longToken === true)
    return [{ ...base, kind: token ? 'token' : 'in', sessionsOnly: token && signed.every((each) => each.sessionsOnly === true) }]
  })
}

/**
 * A hub long-token folder while no Claude folder of the hub is on a full sign-in (BTN-1266): nobody polls `/usage` of
 * it, so its limits come only from its sessions; the fix is a full sign-in on the hub.
 */
export function hubSessionsOnly(entry: AccountEntry, accounts: AccountEntry[]): boolean {
  return entry.longToken !== undefined && sameChoices(accounts).length === 0
}

/**
 * The command of "Sign in fully" (BTN-1266): the hub's Claude folder of the e-mail on a sign-in of its own signs in
 * again, else a new Claude folder signs in.
 */
export function fullSignIn(email: string | null, accounts: AccountEntry[]): [string, Record<string, unknown>] {
  const folder = accounts.find((each) => each.agent === CLAUDE && each.longToken === undefined && !paysPerToken(each) &&
    sameEmail(each.status?.email ?? each.lastEmail ?? null, email))
  return folder === undefined ? ['account/add', { agent: CLAUDE }] : ['account/renew', { account: folder.key }]
}

/** The machine's sign-in under way, the first if several; `undefined` — none. */
export function machineLogin(machines: MachineSignIn[] | undefined): MachineSignIn | undefined {
  return machines?.find((machine) => machine.login !== null)
}

/**
 * The sign-in steps' commands, made for the machine: they go to the hub, which hands them to that machine. "Try again"
 * of the steps renews the folder it signed in to or adds the same agent anew.
 */
export function machineSend(machine: string, send: Send): Send {
  return (name, body = {}) => {
    if (name === 'account/code') return send('machines/code', { machine, code: body.code })
    if (name === 'account/cancel') return send('machines/cancel', { machine })
    if (name === 'account/renew') return send('machines/login', { machine, account: body.account, ...(body.agent !== undefined && { agent: body.agent }) })
    if (name === 'account/add') return send('machines/login', { machine, ...body })
    return send(name, body)
  }
}
