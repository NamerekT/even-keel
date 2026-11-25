import type { AccountEntry, AccountView } from '../../src/account/model.js'
import type { AccountLevel } from '../../src/account/header-levels.js'
import type { MachineCard, MachineCardAccount, MachineSignIn } from '../../src/state.js'
import { hubFolderOf } from '../../src/account/same-account.js'
import { hubGapsOn } from './machineAdd.js'

/** A row of a machine's view it is not signed in to: a hub account not there, or its own folder signed out. */
export interface MachineAway {
  agent: string
  /** The machine's folder its "Sign in" signs in again; absent — a new account there. */
  account?: string
  why: 'hub' | 'out'
  /** The machine has no CLI of the agent: nothing to sign in with. */
  noCli: boolean
}

/** A machine elsewhere's accounts as the hub's blocks read them (BTN-1570). */
export interface MachineAccounts {
  /** Its accounts with the limits it read, the signed-out ones after, then the hub's subscriptions not signed in there. */
  view: AccountView
  /** By key of `view`: the rows it is not signed in to, with what their "Sign in" sends. */
  away: Map<string, MachineAway>
  /** By the hub's folder: the key in `view` of the same account there, signed in if any folder there is. */
  here: Map<string, string>
  /** By key of `view`: the machine's folder of the account; a hub account not there has none. */
  folders: Map<string, string>
  /** By key of `view`: the hub's folder of the same account, whose name it shows and whose Even Keel role it moves (BTN-1584). */
  hubFolders: Map<string, string>
}

/** Where the machine takes an account, as "Used by" names it. */
export interface MachineUse {
  source: AccountLevel['source']
  task?: string
  project?: string
}

const BLANK = {
  global: false, error: null, loginExpiresAt: null, needsLogin: false, sessions: [], projects: [], removing: false,
  configPending: false, apiKey: false, limits: null, usage: { state: 'ok', reason: null, since: null },
} satisfies Partial<AccountEntry>

const keyOf = (account: MachineCardAccount): string => `${account.agent}:${account.key}`

/**
 * The view a machine elsewhere's header and accounts page show in the hub's blocks: an account of the machine takes
 * the name and plan of the hub's folder of the same e-mail (`hubFolderOf`), one name for the hub and every machine
 * (BTN-1584); one the hub lacks, a key among them, its own name there. The limits are the machine's own. Keys are the
 * view's own, so no control of the hub's rows can reach a folder of the hub from it.
 */
export function machineAccountView(hub: AccountView, card: MachineCard, signIn: MachineSignIn | undefined): MachineAccounts {
  const away = new Map<string, MachineAway>()
  const here = new Map<string, string>()
  const folders = new Map<string, string>()
  const hubFolders = new Map<string, string>()
  const ordered = [...card.accounts.filter((each) => each.signedIn), ...card.accounts.filter((each) => !each.signedIn)]
  const own = ordered.map((account): AccountEntry => {
    const match = hubFolderOf(hub.accounts, account.agent, account.email)
    const key = keyOf(account)
    folders.set(key, account.key)
    if (match !== undefined) hubFolders.set(key, match.key)
    if (match !== undefined && !here.has(match.key)) here.set(match.key, key)
    if (!account.signedIn) away.set(key, { agent: account.agent, account: account.key, why: 'out', noCli: signIn?.missing.includes(account.agent) === true })
    return {
      ...BLANK,
      key,
      name: match === undefined ? account.name : match.name,
      agent: account.agent,
      status: {
        loggedIn: account.signedIn,
        authMethod: match?.status?.authMethod ?? null,
        email: account.email ?? match?.status?.email ?? null,
        orgName: match?.status?.orgName ?? null,
        subscriptionType: match?.status?.subscriptionType ?? null,
      },
      limits: account.signedIn ? account.limits : null,
      sessions: account.sessions ?? [],
      ...(account.transport !== undefined && { transport: account.transport }),
      ...(account.removing === true && { removing: true }),
      ...(account.apiKey === true && { apiKey: true }),
    }
  })
  const gaps = signIn === undefined ? [] : hubGapsOn(hub.accounts, signIn).map(({ entry, gap }): AccountEntry => {
    const key = `hub:${entry.key}`
    if (!here.has(entry.key)) here.set(entry.key, key)
    away.set(key, { agent: entry.agent, ...(gap.account !== undefined && { account: gap.account }), why: 'hub', noCli: gap.noCli })
    return { ...BLANK, key, name: entry.name, agent: entry.agent, status: entry.status }
  })
  const active = card.accounts.find((each) => each.key === card.active)
  const viewKeyOf = (folder: string | null) => {
    const found = folder === null ? undefined : card.accounts.find((each) => each.key === folder)
    return found === undefined ? null : keyOf(found)
  }
  return {
    view: {
      active: active === undefined ? '' : keyOf(active),
      accounts: [...own, ...gaps],
      login: null,
      loginBlock: null,
      apps: (card.apps ?? []).map((app) => ({
        ...app,
        account: viewKeyOf(app.account),
        sessions: app.sessions.map((chat) => ({ ...chat, account: viewKeyOf(chat.account) ?? chat.account })),
      })),
      pool: [],
      missing: signIn?.missing ?? [],
    },
    away,
    here,
    folders,
    hubFolders,
  }
}

/**
 * The hub's launch levels as the machine takes them: each the machine's account of the hub's folder (BTN-1311), the
 * shared one its own launch account; a level the machine has nothing of is left out, as the hub leaves out one gone.
 */
export function machineLevels(levels: readonly AccountLevel[], accounts: MachineAccounts): AccountLevel[] {
  const active = accounts.view.active
  const mapped = levels.flatMap((level) => {
    const account = level.source === 'shared' && active !== '' ? active : accounts.here.get(level.account)
    return account === undefined ? [] : [{ ...level, account }]
  })
  return mapped.filter((each, index) => mapped.findIndex((other) => other.account === each.account) === index)
}

const RANK: Record<AccountLevel['source'], number> = { shared: 0, task: 1, project: 2 }

/** By key of the view, the levels the machine takes each account at over the projects given, Even Keel first. */
export function machineUses(levels: Record<string, readonly AccountLevel[]>, accounts: MachineAccounts): Map<string, MachineUse[]> {
  const uses = new Map<string, MachineUse[]>()
  const add = (account: string, use: MachineUse) => {
    const list = uses.get(account) ?? []
    if (!list.some((each) => each.source === use.source && each.task === use.task && each.project === use.project)) list.push(use)
    uses.set(account, list)
  }
  if (accounts.view.active !== '') add(accounts.view.active, { source: 'shared' })
  for (const [project, list] of Object.entries(levels)) {
    for (const level of machineLevels(list, accounts)) {
      add(level.account, level.source === 'shared' ? { source: 'shared' } : level.source === 'task' ? { source: 'task', task: level.task! } : { source: 'project', project })
    }
  }
  for (const list of uses.values()) list.sort((a, b) => RANK[a.source] - RANK[b.source])
  return uses
}
