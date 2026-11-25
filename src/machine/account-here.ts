/**
 * Whose a hub's account folder is, as the hub tells its machines in the brief (BTN-1311): its agent, and the claude.ai
 * account (`oauthAccount.accountUuid`, or the account a long token was said to be of) or the e-mail of its sign-in.
 */
export interface BriefAccount {
  agent: string
  account?: string
  email: string | null
}

/** An account folder of this machine as the matching reads it. */
export interface FolderHere {
  key: string
  agent: string
  /** The claude.ai account of the folder's full sign-in. */
  signed?: string
  /** The claude.ai account the folder's long token was said to be of (`LongToken.account`). */
  token?: string
  email: string | null
}

/** The hub's folders as the brief names their accounts: a folder whose account nothing tells is left out. */
export function briefAccounts(folders: readonly FolderHere[]): Record<string, BriefAccount> {
  const accounts: Record<string, BriefAccount> = {}
  for (const folder of folders) {
    const account = folder.signed ?? folder.token
    if (account === undefined && folder.email === null) continue
    accounts[folder.key] = { agent: folder.agent, ...(account !== undefined && { account }), email: folder.email }
  }
  return accounts
}

/**
 * The folder of this machine that runs what the hub's folder `key` runs (`docs/machines/pool.md`, "The pool"): the one of
 * the same name when it is of the same account, else a full sign-in of that account, else a long token of it; `null` —
 * none here. When the hub told nothing that names the account, the folder of the same name (and agent, if told) or
 * `null` (BTN-1512): a key with no folder here is the account absent from this machine, not a folder to switch from.
 */
export function folderHere(wanted: BriefAccount | undefined, key: string, folders: readonly FolderHere[]): string | null {
  if (wanted === undefined || (wanted.account === undefined && wanted.email === null)) {
    return folders.some((folder) => folder.key === key && (wanted === undefined || folder.agent === wanted.agent)) ? key : null
  }
  const own = folders.filter((folder) => folder.agent === wanted.agent)
  const email = wanted.email?.toLowerCase()
  const signedIn = (folder: FolderHere) =>
    wanted.account === undefined ? folder.email?.toLowerCase() === email : folder.signed === wanted.account && folder.token === undefined
  const ofToken = (folder: FolderHere) => wanted.account !== undefined && folder.token === wanted.account
  const same = own.find((folder) => folder.key === key && (signedIn(folder) || ofToken(folder)))
  return (same ?? own.find(signedIn) ?? own.find(ofToken))?.key ?? null
}
