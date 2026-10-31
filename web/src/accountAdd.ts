import type { AccountLogin } from '../../src/account/model.js'
import { NO_SIGN_IN } from '../../src/agent/providers.js'
import { PROVIDERS, type Provider } from './accounts.js'
import { t } from './i18n/index.js'

export const providerHint = (provider: Provider): string => provider === 'opencode'
  ? ['chatgpt', 'free', 'apiKey'].map(way => t.addAccount.way.opencode[way as 'chatgpt' | 'free' | 'apiKey'].title).join(' · ')
  : t.account.providerHints[provider]

/** How a way adds the account: a sign-in through the agent's CLI, a folder placed at once, or a key checked first. */
export type WayKind = 'login' | 'instant' | 'key'

export interface Way {
  id: string
  kind: WayKind
  /** The `method` of `account/add` (`SIGN_INS`), for an agent with several ways. */
  method?: string
}

/** The ways to add an account of each provider, the one offered first at the top; no Agent SDK — it is how a folder runs, not how it signs in. */
export const WAYS: Record<Provider, readonly Way[]> = {
  claude: [
    { id: 'subscription', kind: 'login' },
    { id: 'apiKey', kind: 'key' },
  ],
  codex: [
    { id: 'subscription', kind: 'login' },
    { id: 'apiKey', kind: 'key' },
  ],
  opencode: [
    { id: 'chatgpt', kind: 'login', method: 'chatgpt' },
    { id: 'free', kind: 'instant', method: NO_SIGN_IN },
    { id: 'apiKey', kind: 'key' },
  ],
  copilot: [
    { id: 'machine', kind: 'instant', method: NO_SIGN_IN },
    { id: 'token', kind: 'key' },
  ],
}

export interface AddAt {
  /** null — the provider is to be picked. */
  provider: Provider | null
  way: Way | null
}

/** Not `add`, the add dialog of /tools, nor `account`, the /stats filter: the dialog opens over any page (BTN-629). */
const ADD = 'addAccount'
const WAY = 'addWay'

function providerOf(name: string | null): Provider | null {
  return PROVIDERS.find((each) => each === name) ?? null
}

function wayOf(provider: Provider, id: string | null): Way {
  const ways = WAYS[provider]
  return ways.find((way) => way.id === id) ?? ways[0]!
}

/** A way is picked in the address: the dialog then goes to it and does not offer the CLI's sign-in on the machine. */
export function wayGiven(search: URLSearchParams): boolean {
  return search.has(WAY)
}

/**
 * The add dialog from the address of the page it is over, so a reload and the browser's Back keep it: null — closed;
 * an unknown provider — its pick; the way picked, the provider's first when absent.
 */
export function addOf(search: URLSearchParams): AddAt | null {
  if (!search.has(ADD)) return null
  const provider = providerOf(search.get(ADD))
  return provider === null ? { provider, way: null } : { provider, way: wayOf(provider, search.get(WAY)) }
}

/** The page's search with the dialog open at a provider (null — its pick) and a way of it. */
export function withAdd(search: string, provider: Provider | null, way?: string): string {
  const params = new URLSearchParams(search)
  params.delete(WAY)
  params.set(ADD, provider ?? '')
  if (provider !== null && way !== undefined) params.set(WAY, way)
  return `?${params.toString()}`
}

/** The page's search with the dialog closed. */
export function withoutAdd(search: string): string {
  const params = new URLSearchParams(search)
  params.delete(ADD)
  params.delete(WAY)
  const text = params.toString()
  return text === '' ? '' : `?${text}`
}

/** Where an address of the old add page goes: the accounts list with the dialog, its key connection as the provider's key way. */
export function legacyAdd(search: URLSearchParams): string {
  const provider = providerOf(search.get('provider'))
  const key = provider === null || search.get('connection') !== 'apiKey' ? undefined : WAYS[provider].find((way) => way.kind === 'key')?.id
  return `/accounts${withAdd('', provider, key)}`
}

/** What is typed for one provider; the key stays in the page's memory only, never in the address or the storage. */
export interface Draft {
  name: string
  key: string
  /** The way last picked, so coming back to the provider finds it again. */
  way: string
}

export type Drafts = Partial<Record<Provider, Draft>>

/** Whether closing loses something typed: a name or a key; a picked way alone is not worth asking about. */
export function dirty(drafts: Drafts): boolean {
  return Object.values(drafts).some((draft) => draft.name.trim() !== '' || draft.key.trim() !== '')
}

export type LoginRow = 'open' | 'signIn' | 'code'

/**
 * The step of a running sign-in to mark, by what the person did here: the link opened, the code typed or copied.
 * The sign-in itself happens on another site, so it is the step between the two.
 */
export function loginRow(login: AccountLogin, done: { opened: boolean; coding: boolean }): LoginRow {
  if (login.urls.length === 0) return 'open'
  if (done.coding || login.codeSent) return 'code'
  return done.opened ? 'signIn' : 'open'
}

/** The accounts that came since the mark taken before an add, to light up on the list; none without a mark. */
export function freshKeys(before: ReadonlySet<string> | null, keys: string[]): string[] {
  return before === null ? [] : keys.filter((key) => !before.has(key))
}

/**
 * How many history entries the dialog's own steps pushed over its page, from the entry's state (`{ adding }`): closing
 * goes back over them, so the browser's Back does not open it again. 0 — the address was opened as it is.
 */
export function addDepth(state: unknown): number {
  const adding = (state as { adding?: unknown } | null)?.adding
  return typeof adding === 'number' && Number.isInteger(adding) && adding > 0 ? adding : 0
}

/** The command that starts a failed sign-in again: the same way for a new account, the renewal for an existing one. */
export function retryBody(login: AccountLogin): [string, Record<string, unknown>] {
  if (login.target !== null) return ['account/renew', { account: login.target }]
  return ['account/add', { agent: login.agent, ...(login.method !== undefined && { method: login.method }) }]
}

/**
 * A sign-in Even Keel refused for its plan once the CLI had signed in: the CLI output ends in its success, and only
 * another account makes a new try worth it.
 */
export function planRefused(login: AccountLogin): boolean {
  const code = login.error?.code
  return code === 'account.secondFree' || code === 'account.sameFree'
}
