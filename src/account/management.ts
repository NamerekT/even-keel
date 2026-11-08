import type { Queryable } from '../storage/database.js'

/** Tells the account's credits bought and used, only to a management key: the key a session runs on gets 403. */
const OPENROUTER_CREDITS_URL = 'https://openrouter.ai/api/v1/credits'

/** What a management key read of the account's balance (BTN-868): dollars left, a refused key, or nothing learned. */
export type BalanceVerdict = { state: 'ok'; usd: number } | { state: 'rejected' } | { state: 'unknown'; reason: string }

/** The account's balance, `total_credits` less `total_usage`; 401 and 403 are a key that is no management key. */
export async function readOpenRouterBalance(key: string, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<BalanceVerdict> {
  let response: Response
  try {
    response = await fetchImpl(OPENROUTER_CREDITS_URL, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    return { state: 'unknown', reason: error instanceof Error ? error.message : String(error) }
  }
  if (!response.ok) {
    await response.body?.cancel()
    if (response.status === 401 || response.status === 403) return { state: 'rejected' }
    return { state: 'unknown', reason: `HTTP ${response.status}` }
  }
  const body: unknown = await response.json().catch(() => null)
  const data = typeof body === 'object' && body !== null ? (body as { data?: unknown }).data : null
  const { total_credits: credits, total_usage: usage } = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {}
  if (typeof credits !== 'number' || !Number.isFinite(credits) || typeof usage !== 'number' || !Number.isFinite(usage)) {
    return { state: 'unknown', reason: 'no credits in the answer' }
  }
  return { state: 'ok', usd: Math.round((credits - usage) * 1e6) / 1e6 }
}

/**
 * The management key of each OpenRouter account, kept out of the account's folder that its sessions read (BTN-868).
 * Keyed by the account folder's key; table `management_keys` (step 37, `docs/storage.md`).
 */
export async function loadManagementKeys(db: Queryable): Promise<Map<string, string>> {
  const { rows } = await db.query<{ account: string; key: string }>('select account, key from management_keys order by account')
  return new Map(rows.map((row) => [row.account, row.key]))
}

/** Starts its write at the call: see `Writes`. */
export async function saveManagementKey(db: Queryable, account: string, key: string, at: Date): Promise<void> {
  await db.query(
    `insert into management_keys (account, key, saved_at) values ($1, $2, $3)
       on conflict (account) do update set key = excluded.key, saved_at = excluded.saved_at`,
    [account, key, at.toISOString()],
  )
}

export async function forgetManagementKey(db: Queryable, account: string): Promise<void> {
  await db.query('delete from management_keys where account = $1', [account])
}
