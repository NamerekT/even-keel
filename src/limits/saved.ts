import type { Queryable } from '../storage/database.js'
import type { RateLimits } from './model.js'

/**
 * The last limits a poll or a session told of each account (BTN-631), so that after a restart the page and the chain
 * start from them rather than from an old statusline file. Keyed by the account folder's key; table `account_limits`
 * (step 25, `docs/storage.md`).
 */
export async function loadSavedLimits(db: Queryable): Promise<Map<string, RateLimits>> {
  const { rows } = await db.query<{ account: string; limits: string }>('select account, limits from account_limits order by account')
  return new Map(rows.map((row) => [row.account, JSON.parse(row.limits) as RateLimits]))
}

/** `undefined` forgets the account's row. Starts its write at the call: see `Writes`. */
export async function saveLimits(db: Queryable, account: string, limits: RateLimits | undefined): Promise<void> {
  if (limits === undefined) {
    await db.query('delete from account_limits where account = $1', [account])
    return
  }
  await db.query(
    'insert into account_limits (account, limits) values ($1, $2) on conflict (account) do update set limits = excluded.limits',
    [account, JSON.stringify(limits)],
  )
}
