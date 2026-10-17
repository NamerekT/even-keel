import type { AccountEntry, AccountView } from '../../src/account/model.js'
import { CODEX } from '../../src/codex/name.js'

const SERIES = 8

/** The series colour (1–8) of the account with this e-mail: by the order of the folder keys, so it is the same on every page. */
export function accountSlot(view: AccountView | undefined, email: string): number | null {
  if (view === undefined) return null
  const owner = view.accounts.find((entry) => entry.status?.email === email)
  if (owner === undefined) return null
  const keys = view.accounts.map((entry) => entry.key).sort()
  return (keys.indexOf(owner.key) % SERIES) + 1
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
export function deviceLogin({ login, accounts }: AccountView): boolean {
  if (login === null || login.target === null) return false
  return accounts.find((entry) => entry.key === login.target)?.agent === CODEX
}

/** Whether the page can add such an account; the rest are shown as not there yet. Without a connection — the provider at all. */
export function canAdd(provider: Provider, connection?: Connection): boolean {
  if (provider === 'opencode') return false
  if (connection === undefined || connection === 'cli') return true
  return connection === 'apiKey' && provider === 'claude'
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
