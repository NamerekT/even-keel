// The limit shares stored (BTN-1658, step 24): `limit_shares_stored` keeps the rows of `limit_shares`, and a writer
// refreshes it whole once it wrote rows the shares are computed from. Concurrently: a /stats read during the refresh
// reads the previous rows instead of waiting.

export const REFRESH_LIMIT_SHARES = 'refresh materialized view concurrently limit_shares_stored'

/** What a collector run wrote that the shares are computed from: lines read, new limit snapshots, new keep-warm pings. */
export interface ShareInputs {
  lines: number
  snapshots: number
  pings: number
}

/**
 * Whether the run's rows call for a refresh. A changed price or task of an older response alone waits for the next
 * run that brings any of these: the stats read the task from `message_costs`, never from the shares.
 */
export function sharesStale(run: ShareInputs): boolean {
  return run.lines > 0 || run.snapshots > 0 || run.pings > 0
}

/** The refresh at the end of a collector run, only when it wrote their inputs; the words of the run's summary line. */
export async function refreshShares(db: { refreshLimitShares(): Promise<void> }, run: ShareInputs, now: () => number = Date.now): Promise<string> {
  if (!sharesStale(run)) return 'limit shares kept'
  const started = now()
  await db.refreshLimitShares()
  return `limit shares refreshed in ${((now() - started) / 1000).toFixed(1)} s`
}
