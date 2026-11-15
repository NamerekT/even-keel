import { CLAUDE } from '../claude/name.js'
import { fail } from '../notice/notice.js'
import type { AccountHome, AccountHomes } from './homes.js'
import { assertLongToken, restoreLongToken, takeLongToken, writeLongToken } from './longToken.js'

export interface TokenAccounts {
  homes: AccountHomes
  /** One short turn on the folder (`Agent.write`): `auth status` takes any token, so only a request tells a working one. */
  check: (home: AccountHome) => Promise<unknown>
  now: () => Date
}

const reasonOf = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason)).slice(0, 500)

/** The folder with a full sign-in the token is said to be of: a Claude folder that is on no token itself. */
function sameAccount(homes: AccountHomes, key: string | undefined): string | undefined {
  if (key === undefined || key === '') return undefined
  const home = homes.find(key)
  if (home === undefined || home.agent !== CLAUDE || homes.longTokenOf(home) !== null) throw fail('account.unknown', { key })
  return key
}

/**
 * A subscription account on a long token (BTN-1005): the folder is made, one short turn runs on it, and a refusal
 * removes it again, so no account is added that cannot run a session.
 */
export async function addTokenAccount(accounts: TokenAccounts, name: string, token: string, sameAs?: string): Promise<AccountHome> {
  const value = assertLongToken(token)
  const same = sameAccount(accounts.homes, sameAs)
  const home = accounts.homes.addLongToken(name, value, accounts.now(), same)
  try {
    await accounts.check(home)
  } catch (reason) {
    await accounts.homes.remove(home)
    throw fail('account.tokenRejected', { reason: reasonOf(reason) })
  }
  return home
}

/**
 * A new token in the folder of a long-token account, its name, roles and pools kept: checked by one short turn, and the
 * old one is put back when the new one is refused. Running sessions go on with the token they started with.
 */
export async function replaceToken(accounts: TokenAccounts, home: AccountHome, token: string): Promise<void> {
  const value = assertLongToken(token)
  const held = home.global ? null : takeLongToken(home.dir)
  if (held === null) throw fail('account.keyNotHeld', { agent: home.agent })
  const sameAs = accounts.homes.longTokenOf(home)?.sameAs
  writeLongToken(home.dir, value, accounts.now(), sameAs)
  try {
    await accounts.check(home)
  } catch (reason) {
    restoreLongToken(home.dir, held)
    throw fail('account.tokenRejected', { reason: reasonOf(reason) })
  }
}
