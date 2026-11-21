import type { Queryable } from '../storage/database.js'
import type { TurnSpend } from '../state.js'
import type { CacheTtl } from './transcript.js'

/**
 * One keep-warm ping as Tally counts it (BTN-1413): its fork writes no transcript, so this record is the only trace of
 * what it took from the account's limit. `project` is the project's id, `null` when the task's project is not known.
 */
export interface WarmPing {
  at: string
  sessionId: string
  task: string
  project: string | null
  account: string
  model: string | null
  input: number
  cacheWrite5m: number
  cacheWrite1h: number
  cacheRead: number
  output: number
}

/** A ping as the hub keeps it: `machine` — the id of the machine whose fork sent it. */
export interface StoredWarmPing extends WarmPing {
  machine: string
}

export interface WarmPingOf {
  at: string
  sessionId: string
  task: string
  project: string | null
  account: string
  /** The model the session runs on, for an agent that names none in its answer. */
  model: string | null
  /** The lifetime of the session's cache: the fork asks for the same one, so it is what its write is. */
  ttl: CacheTtl
}

/** The ping's record from what its one call read and wrote. Agents give the write as one number: it takes the session's lifetime. */
export function warmPingOf(spend: TurnSpend, of: WarmPingOf): WarmPing {
  const { ttl, ...rest } = of
  const { input, output, cacheRead, cacheWrite } = spend.tokens
  const hour = ttl === '1h'
  return { ...rest, model: spend.model ?? of.model, input, cacheWrite5m: hour ? 0 : cacheWrite, cacheWrite1h: hour ? cacheWrite : 0, cacheRead, output }
}

/** Keeps a ping in `warm_pings` (step 70, `docs/storage.md`); the same ping again changes nothing. */
export async function saveWarmPing(db: Queryable, machine: string, ping: WarmPing): Promise<void> {
  await db.query(
    `insert into warm_pings (session_id, at, machine_id, account, task, project_id, model, input, cache_write_5m, cache_write_1h, cache_read, output)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) on conflict (session_id, at) do nothing`,
    [ping.sessionId, ping.at, machine, ping.account, ping.task, ping.project, ping.model, ping.input, ping.cacheWrite5m, ping.cacheWrite1h, ping.cacheRead, ping.output],
  )
}

interface PingRow {
  session_id: string
  at: string
  machine_id: string
  account: string
  task: string
  project_id: string | null
  model: string | null
  input: number
  cache_write_5m: number
  cache_write_1h: number
  cache_read: number
  output: number
}

export async function readWarmPings(db: Queryable): Promise<StoredWarmPing[]> {
  const { rows } = await db.query<PingRow>(
    `select session_id, at, machine_id, account, task, project_id, model, input, cache_write_5m, cache_write_1h, cache_read, output
     from warm_pings order by at, session_id`,
  )
  return rows.map((row) => ({
    at: new Date(row.at).toISOString(),
    sessionId: row.session_id,
    machine: row.machine_id,
    account: row.account,
    task: row.task,
    project: row.project_id,
    model: row.model,
    input: Number(row.input),
    cacheWrite5m: Number(row.cache_write_5m),
    cacheWrite1h: Number(row.cache_write_1h),
    cacheRead: Number(row.cache_read),
    output: Number(row.output),
  }))
}
