import type { AccountEntry, AccountView } from '../../src/account/model.js'
import { PROVIDERS as RUN_PROVIDERS } from '../../src/agent/providers.js'
import { CODEX } from '../../src/codex/name.js'
import { accountOrder } from './state.js'

const SERIES = 8

/** The series colour (1–8) of the account with this e-mail: by the order of the folder keys, so it is the same on every page. */
export function accountSlot(view: AccountView | undefined, email: string): number | null {
  if (view === undefined) return null
  const owner = view.accounts.find((entry) => entry.status?.email === email)
  if (owner === undefined) return null
  const keys = view.accounts.map((entry) => entry.key).sort()
  return (keys.indexOf(owner.key) % SERIES) + 1
}

/** The series colour of an account folder: by its e-mail, so sessions and cards agree; by its key when it has none. */
export function entrySlot(view: AccountView, entry: AccountEntry): number {
  const email = entry.status?.email ?? null
  const byEmail = email === null ? null : accountSlot(view, email)
  if (byEmail !== null) return byEmail
  const keys = view.accounts.map((each) => each.key).sort()
  return (keys.indexOf(entry.key) % SERIES) + 1
}

export function folderEmail(view: AccountView | undefined, key: string): string {
  return view?.accounts.find((entry) => entry.key === key)?.status?.email ?? key
}

/** Whose account it is: the agents of `src/agent/adapters.ts` and the ones the page only names for now. */
export const PROVIDERS = ['claude', 'codex', 'opencode'] as const
export type Provider = (typeof PROVIDERS)[number]

/** How the account signs in: through the agent's CLI, through the Agent SDK, or with an API key. */
export const CONNECTIONS = ['cli', 'sdk', 'apiKey'] as const
export type Connection = (typeof CONNECTIONS)[number]

export function connectionOf(entry: AccountEntry): Connection {
  return entry.apiKey ? 'apiKey' : 'cli'
}

/** Whether the running sign-in is Codex's device-auth: the one-time code from its output goes on the sign-in page, nothing is typed here. */
export function deviceLogin({ login }: AccountView): boolean {
  return login?.agent === CODEX
}

/** Whether the page can add such an account; the rest are shown as not there yet. Without a connection — the provider at all. */
export function canAdd(provider: Provider, connection?: Connection): boolean {
  if (provider === 'opencode') return false
  return connection !== 'sdk'
}

/** Whether the service does not find the provider's CLI: no account of it is added, the page says where to get it. */
export function cliMissing(view: AccountView, provider: Provider): boolean {
  return view.missing.includes(provider)
}

/**
 * The providers a project's or the shared settings offer to run on: the ones with an account, and any a setting there
 * already names (`named`); every one until the accounts are known.
 */
export function offeredProviders(view: AccountView | null, named: string[]): string[] {
  if (view === null) return [...RUN_PROVIDERS]
  return RUN_PROVIDERS.filter((provider) => named.includes(provider) || view.accounts.some((entry) => entry.agent === provider))
}

export interface AccountGroup {
  agent: string
  entries: AccountEntry[]
}

/**
 * The accounts by provider, in the order of `PROVIDERS`, an agent the page does not know after them. A provider that can be
 * added and whose CLI is found has its group even with no account, so the page can offer to add one there. Inside a group the chain's account
 * comes first, then the ones that can work now.
 */
export function accountGroups(view: AccountView, now: Date): AccountGroup[] {
  const ordered = accountOrder(view.accounts, now)
  const sorted = [...ordered.filter((entry) => entry.key === view.active), ...ordered.filter((entry) => entry.key !== view.active)]
  const known: string[] = PROVIDERS.filter((provider) => canAdd(provider) && !cliMissing(view, provider))
  const agents = [...known, ...new Set(sorted.map((entry) => entry.agent).filter((agent) => !known.includes(agent)))]
  return agents
    .map((agent) => ({ agent, entries: sorted.filter((entry) => entry.agent === agent) }))
    .filter((group) => group.entries.length > 0 || known.includes(group.agent))
}

export interface AddStep {
  provider: Provider | null
  connection: Connection | null
}

/** The step of the add page from its URL, so the browser's Back goes a step back: a provider, then a connection. */
export function addStep(search: URLSearchParams): AddStep {
  const provider = PROVIDERS.find((each) => each === search.get('provider')) ?? null
  const connection = CONNECTIONS.find((each) => each === search.get('connection')) ?? null
  if (provider === null || !canAdd(provider)) return { provider, connection: null }
  return { provider, connection }
}
