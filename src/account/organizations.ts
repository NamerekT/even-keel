import type { Queryable } from '../storage/database.js'

/**
 * The organization each API account's key pays through, as the provider last named it to a working key (BTN-418):
 * a dead key's answer names none, so it is kept while the key works, and a replacing key of another one is refused.
 * Keyed by the account folder's key; table `key_organizations` (step 14, `docs/storage.md`).
 */
export async function loadKeyOrganizations(db: Queryable): Promise<Map<string, string>> {
  const { rows } = await db.query<{ account: string; organization: string }>('select account, organization from key_organizations order by account')
  return new Map(rows.map((row) => [row.account, row.organization]))
}

/** Starts its write at the call: see `Writes`. */
export async function saveKeyOrganization(db: Queryable, account: string, organization: string, at: Date): Promise<void> {
  await db.query(
    `insert into key_organizations (account, organization, seen_at) values ($1, $2, $3)
       on conflict (account) do update set organization = excluded.organization, seen_at = excluded.seen_at`,
    [account, organization, at.toISOString()],
  )
}

export async function forgetKeyOrganization(db: Queryable, account: string): Promise<void> {
  await db.query('delete from key_organizations where account = $1', [account])
}
