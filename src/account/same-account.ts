/** Two e-mails of one account, as the CLIs write them in any case; `null` is no one's. */
export const sameEmail = (a: string | null, b: string | null): boolean => a !== null && b !== null && a.toLowerCase() === b.toLowerCase()

interface Folder {
  key: string
  agent: string
  status?: { email?: string | null } | null
  lastEmail?: string | null
  longToken?: unknown
}

/**
 * The hub's folder a machine elsewhere's account is known by (BTN-1570, BTN-1584): the same agent and e-mail, a full
 * sign-in before a long token. Its name is the account's name on the hub and on every machine; an account with no
 * e-mail (a key) has none.
 */
export function hubFolderOf<T extends Folder>(hub: readonly T[], agent: string, email: string | null): T | undefined {
  const same = hub.filter((entry) => entry.agent === agent && sameEmail(entry.status?.email ?? entry.lastEmail ?? null, email))
  return same.find((entry) => entry.longToken === undefined) ?? same[0]
}
