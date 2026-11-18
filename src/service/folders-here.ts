import { CLAUDE } from '../claude/name.js'
import type { AccountHome } from '../account/homes.js'
import type { LongToken } from '../account/model.js'
import type { AccountIdentities } from '../limits/identity.js'
import type { FolderHere } from '../machine/account-here.js'

export interface FoldersHereContext {
  homes: { list(): AccountHome[]; configFile(home: AccountHome): string }
  account: { shownEmailOf(key: string): string | null; longToken(key: string): LongToken | undefined }
}

/**
 * The account folders of this installation with whose account each is (BTN-1311): a Claude folder's full sign-in and the
 * account its long token was said to be of, any folder's e-mail as its sign-in last showed it.
 */
export function foldersHere(ctx: FoldersHereContext, identities: AccountIdentities): FolderHere[] {
  return ctx.homes.list().map((home) => {
    const email = ctx.account.shownEmailOf(home.key)
    if (home.agent !== CLAUDE) return { key: home.key, agent: home.agent, email }
    const token = ctx.account.longToken(home.key)
    const signed = token === undefined ? identities.of(ctx.homes.configFile(home)) : undefined
    return {
      key: home.key,
      agent: home.agent,
      email: signed?.email ?? token?.account?.email ?? email,
      ...(signed !== undefined && { signed: signed.account }),
      ...(token?.account !== undefined && { token: token.account.account }),
    }
  })
}
