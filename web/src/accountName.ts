import type { AccountEntry, AccountView } from '../../src/account/model.js'
import { OPENCODE } from '../../src/opencode/name.js'
import { t } from './i18n/index.js'

/** What OpenCode runs on with no provider signed in: its own free models. */
const OPENCODE_FREE = 'OpenCode Zen'

/** The agent of an account as the page names it; one the page does not know yet by its registry name. */
export function agentLabel(agent: string): string {
  return (t.account.agents as Record<string, string>)[agent] ?? agent
}

/**
 * The one name the page shows an account by, wherever it is seen or chosen: the name the user gave it, else its
 * e-mail, else its provider's — numbered by the folder keys when `accounts` holds another that would read the same. The
 * folder key is the account's identity, not its name: only the mark's tip shows it.
 */
export function accountName(entry: AccountEntry, accounts: AccountEntry[] = [entry]): string {
  if (entry.name !== null) return entry.name
  const email = emailOf(entry)
  if (email !== null) return email
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

/** An API account's status carries its folder key for an e-mail (`withIdentity`): that is no name. */
function emailOf(entry: AccountEntry): string | null {
  const email = entry.status?.email ?? null
  return email === entry.key ? null : email
}

/** The provider, and for OpenCode whether it runs on the free models: the providers it is signed in to are its plan. */
function providerName(entry: AccountEntry): string {
  if (entry.agent === OPENCODE && entry.status !== null && entry.status.subscriptionType === null) return OPENCODE_FREE
  return agentLabel(entry.agent)
}
