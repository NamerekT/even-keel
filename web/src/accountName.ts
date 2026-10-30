import { namedAfter, type AccountEntry, type AccountView } from '../../src/account/model.js'
import { CODEX } from '../../src/codex/name.js'
import { OPENCODE } from '../../src/opencode/name.js'
import { t } from './i18n/index.js'

/** What OpenCode runs on with no provider signed in: its own free models. */
const OPENCODE_FREE = 'OpenCode Zen'

/** The agent of an account as the page names it; one the page does not know yet by its registry name. */
export function agentLabel(agent: string): string {
  return (t.account.agents as Record<string, string>)[agent] ?? agent
}

/** Where a global account folder lives, as the page shows it. */
export function globalFolder(agent: string): string {
  return agent === CODEX ? '~/.codex' : '~/.claude'
}

/**
 * The one name the page shows an account by, wherever it is seen or chosen: the name the user gave it, else its
 * e-mail — while signed out the one it was last signed in as, else its folder (BTN-528) — else its provider's, numbered
 * by the folder keys when `accounts` holds another that would read the same. Otherwise the folder key is the account's
 * identity, not its name: only the mark's tip shows it.
 */
export function accountName(entry: AccountEntry, accounts: AccountEntry[] = [entry]): string {
  if (entry.name !== null) return entry.name
  const email = emailOf(entry) ?? lastEmailOf(entry)
  if (email !== null) return email
  if (entry.status?.loggedIn === false) return entry.global ? globalFolder(entry.agent) : entry.key
  const name = providerName(entry)
  const same = accounts
    .filter((each) => each.name === null && emailOf(each) === null && providerName(each) === name)
    .map((each) => each.key)
    .sort()
  const place = same.indexOf(entry.key)
  return place > 0 ? `${name} ${place + 1}` : name
}

/** The name of the account folder `key`; a key no longer listed as it is. */
export function folderLabel(view: AccountView | undefined, key: string): string {
  const entry = view?.accounts.find((account) => account.key === key)
  return entry === undefined ? key : accountName(entry, view!.accounts)
}

/** The account a session's record names: by its folder key, else by its e-mail; `undefined` once it is gone. */
export function accountOf(view: AccountView | undefined, account: string): AccountEntry | undefined {
  return view?.accounts.find((entry) => entry.key === account) ?? view?.accounts.find((entry) => entry.status?.email === account)
}

/**
 * The account `entry` is signed in to that another folder of its agent holds as well, the one that holds it rightly:
 * global or named after its e-mail, else the first of `accounts`. Null for that one, and for a folder alone with its
 * account (BTN-528).
 */
export function sameAccountAs(entry: AccountEntry, accounts: AccountEntry[]): AccountEntry | null {
  const email = signedInEmail(entry)
  if (email === null) return null
  const same = accounts.filter((each) => each.agent === entry.agent && signedInEmail(each) === email)
  if (same.length < 2) return null
  const holder = same.find((each) => each.global || namedAfter(each.key, email)) ?? same[0]!
  return holder.key === entry.key ? null : holder
}

function signedInEmail(entry: AccountEntry): string | null {
  if (entry.needsLogin || entry.apiKey || entry.status?.loggedIn !== true) return null
  return emailOf(entry)?.toLowerCase() ?? null
}

/** An API account's status carries its folder key for an e-mail (`withIdentity`): that is no name. */
function emailOf(entry: AccountEntry): string | null {
  const email = entry.status?.email ?? null
  return email === entry.key ? null : email
}

function lastEmailOf(entry: AccountEntry): string | null {
  const email = entry.lastEmail ?? null
  return email === entry.key ? null : email
}

/** The provider, and for OpenCode whether it runs on the free models: the providers it is signed in to are its plan. */
function providerName(entry: AccountEntry): string {
  if (entry.agent === OPENCODE && entry.status !== null && entry.status.subscriptionType === null) return OPENCODE_FREE
  return agentLabel(entry.agent)
}
