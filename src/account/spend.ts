import type { Queryable } from '../storage/database.js'
import { OPENROUTER_KEY_URL, openRouterLimit, type KeyLimit } from './keycheck.js'

/** One read of `GET /api/v1/key`: what the key has spent, in dollars, and its own limit (null — none or not told). */
export interface OpenRouterKeyRead {
  usage: number | null
  limit: KeyLimit | null
}

/**
 * Reads an OpenRouter key's description of itself, which any key may read (BTN-860, BTN-847); `null` — no answer, an
 * error or a body that is no description.
 */
export async function readOpenRouterKey(key: string, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<OpenRouterKeyRead | null> {
  try {
    const response = await fetchImpl(OPENROUTER_KEY_URL, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) {
      await response.body?.cancel()
      return null
    }
    const body: unknown = await response.json()
    const data = typeof body === 'object' && body !== null ? (body as { data?: unknown }).data : undefined
    if (typeof data !== 'object' || data === null) return null
    const usage = (data as { usage?: unknown }).usage
    return { usage: typeof usage === 'number' && Number.isFinite(usage) ? usage : null, limit: openRouterLimit(data) }
  } catch {
    return null
  }
}

/** What a read of the key gave one session: a growth of `usage`, or the mark that it shared the key (`usd` 0). */
export interface KeySpendGrowth {
  sessionId: string
  account: string
  usd: number
  shared: boolean
  at: string
}

export interface KeySpendOptions {
  /** Whether the account's key tells its own spend: an OpenCode account on an OpenRouter key. */
  metered: (account: string) => boolean
  /** The key's `usage` now; `null` — not read this time. */
  read: (account: string) => Promise<number | null>
  onSpend: (growth: KeySpendGrowth) => void
  now: () => number
  /** How long after the last turn on the account a growth still goes to its session. */
  tailMs: number
  /** How often the key is read during the tail. */
  pollMs: number
}

/** A session seen by the monitor: its account folder and whether a turn of it runs. */
export interface KeySpendEntry {
  account: string
  sessionId: string
  busy: boolean
}

interface Meter {
  /** `usage` at the last read; `null` — not read yet. */
  usage: number | null
  /** The sessions busy at some tick since the last read was taken. */
  ran: Set<string>
  /** Busy at the last tick. */
  busy: Set<string>
  /** Whom a growth goes to when no session ran since the last read: the session of the last turn, during the tail. */
  last: string | null
  /** When the last turn ended; `null` — no tail runs. */
  endedAt: number | null
  triedAt: number
  /** The reads in turn: one at a time, so a growth is never counted twice. */
  reads: Promise<void>
  queued: Promise<void> | null
}

/**
 * The real spend of the sessions on a key that tells it (BTN-860, `docs/tally.md`, "Cost"): the key is read before each
 * turn, at each turn's end and during a tail after the last turn, and the growth between two reads goes to the session
 * that ran in between, or to the last one while its tail lasts. Two sessions in one interval, or busy at once, cannot
 * be told apart: both are marked shared and keep only the estimate by price.
 */
export class KeySpend {
  private readonly meters = new Map<string, Meter>()
  private readonly shared = new Set<string>()

  constructor(private readonly options: KeySpendOptions) {}

  /** Reads the key before a turn starts, so what was spent before goes to whoever spent it. */
  async beforeTurn(account: string): Promise<void> {
    if (!this.options.metered(account)) return
    await this.read(account, this.meter(account))
  }

  /** One tick of the session monitor: every session it sees, of every account. */
  observe(entries: KeySpendEntry[]): void {
    const now = this.options.now()
    const busyOf = new Map<string, Set<string>>()
    for (const entry of entries) {
      if (!this.options.metered(entry.account)) continue
      const busy = busyOf.get(entry.account) ?? new Set<string>()
      if (entry.busy) busy.add(entry.sessionId)
      busyOf.set(entry.account, busy)
    }
    for (const account of this.meters.keys()) if (!busyOf.has(account) && this.options.metered(account)) busyOf.set(account, new Set())
    for (const [account, busy] of busyOf) {
      if (busy.size === 0 && !this.meters.has(account)) continue
      const meter = this.meter(account)
      // Busy before any read of the key: the turn began before the service started or with its read failed, and
      // the spend up to the first read is lost, so the session keeps the estimate (BTN-871).
      if (busy.size > 1 || (busy.size > 0 && meter.usage === null)) this.markShared(account, busy)
      for (const sessionId of busy) meter.ran.add(sessionId)
      const ended = [...meter.busy].some((sessionId) => !busy.has(sessionId))
      meter.busy = busy
      if (ended) {
        meter.endedAt = now
        void this.read(account, meter)
      } else if (busy.size === 0 && meter.endedAt !== null) {
        if (now - meter.endedAt > this.options.tailMs) {
          meter.endedAt = null
          meter.last = null
        } else if (now - meter.triedAt >= this.options.pollMs) void this.read(account, meter)
      }
    }
  }

  /** Every read asked for so far has been made. */
  async settled(): Promise<void> {
    await Promise.all([...this.meters.values()].map((meter) => meter.reads))
  }

  private meter(account: string): Meter {
    let meter = this.meters.get(account)
    if (meter === undefined) {
      meter = { usage: null, ran: new Set(), busy: new Set(), last: null, endedAt: null, triedAt: 0, reads: Promise.resolve(), queued: null }
      this.meters.set(account, meter)
    }
    return meter
  }

  private read(account: string, meter: Meter): Promise<void> {
    if (meter.queued !== null) return meter.queued
    const queued = meter.reads.then(async () => {
      meter.queued = null
      const owners = meter.ran
      meter.ran = new Set(meter.busy)
      meter.triedAt = this.options.now()
      const usage = await this.options.read(account).catch(() => null)
      if (usage === null) {
        for (const sessionId of owners) meter.ran.add(sessionId)
        return
      }
      this.settle(account, meter, owners, usage)
    })
    meter.queued = queued
    meter.reads = queued
    return queued
  }

  private settle(account: string, meter: Meter, ran: Set<string>, usage: number): void {
    const owners = ran.size > 0 ? ran : meter.last === null ? new Set<string>() : new Set([meter.last])
    const growth = meter.usage === null ? 0 : usage - meter.usage
    meter.usage = usage
    if (owners.size > 1) {
      this.markShared(account, owners)
      meter.last = null
      return
    }
    const [owner] = owners
    if (owner === undefined) return
    meter.last = owner
    if (growth > 0 && !this.shared.has(owner)) {
      this.options.onSpend({ sessionId: owner, account, usd: growth, shared: false, at: new Date(this.options.now()).toISOString() })
    }
  }

  private markShared(account: string, sessions: Set<string>): void {
    for (const sessionId of sessions) {
      if (this.shared.has(sessionId)) continue
      this.shared.add(sessionId)
      this.options.onSpend({ sessionId, account, usd: 0, shared: true, at: new Date(this.options.now()).toISOString() })
    }
  }
}

/**
 * Adds a growth to the session's row of `key_spends` (step 35, `docs/storage.md`): the sum grows in SQL, so a write
 * behind never loses another. Starts its write at the call: see `Writes`.
 */
export async function saveKeySpend(db: Queryable, growth: KeySpendGrowth): Promise<void> {
  await db.query(
    `insert into key_spends (session_id, account, usd, shared, reads, first_at, last_at) values ($1, $2, $3, $4, 1, $5, $5)
       on conflict (session_id) do update set usd = key_spends.usd + excluded.usd, shared = key_spends.shared or excluded.shared,
         reads = key_spends.reads + 1, last_at = excluded.last_at`,
    [growth.sessionId, growth.account, growth.usd, growth.shared, growth.at],
  )
}

/** A session's real spend on its key, as Tally takes it. */
export interface SessionKeySpend {
  sessionId: string
  account: string
  usd: number
  shared: boolean
  firstAt: string
  lastAt: string
}

export async function readKeySpends(db: Queryable): Promise<SessionKeySpend[]> {
  const { rows } = await db.query<{ session_id: string; account: string; usd: number; shared: boolean; first_at: string | Date; last_at: string | Date }>(
    'select session_id, account, usd, shared, first_at, last_at from key_spends order by first_at, session_id',
  )
  const iso = (value: string | Date) => new Date(value).toISOString()
  return rows.map((row) => ({ sessionId: row.session_id, account: row.account, usd: Number(row.usd), shared: row.shared, firstAt: iso(row.first_at), lastAt: iso(row.last_at) }))
}
