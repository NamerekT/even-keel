import type { SavedWindow } from '../agent/windows.js'
import type { Queryable } from './database.js'

/** The newest answers kept; an older one only costs one more question of the agent. */
export const CONTEXT_WINDOWS_KEPT = 200
/** The sessions whose last window is kept, as many as the monitor holds in memory. */
export const SESSION_WINDOWS_KEPT = 500

/**
 * The context windows the agents named (BTN-946), kept through a restart; tables `context_windows` and
 * `session_windows` (step 44, `docs/storage.md`).
 */
export async function loadContextWindows(db: Queryable): Promise<SavedWindow[]> {
  const { rows } = await db.query<{ account: string; model: string; settings: string | null; stamp: string; window_size: number | null; measured_at: number | bigint }>(
    'select account, model, settings, stamp, window_size, measured_at from context_windows order by measured_at, account, model',
  )
  return rows.map((row) => ({ account: row.account, model: row.model, settings: row.settings, stamp: row.stamp, window: row.window_size, measuredAt: Number(row.measured_at) }))
}

/** Starts its write at the call: see `Writes`. */
export async function saveContextWindow(db: Queryable, window: SavedWindow): Promise<void> {
  await db.query(
    `insert into context_windows (account, model, settings, stamp, window_size, measured_at) values ($1, $2, $3, $4, $5, $6)
       on conflict (account, model, settings) do update set stamp = excluded.stamp, window_size = excluded.window_size, measured_at = excluded.measured_at`,
    [window.account, window.model, window.settings, window.stamp, window.window, window.measuredAt],
  )
  await db.query(
    'delete from context_windows where ctid in (select ctid from context_windows order by measured_at desc offset $1)',
    [CONTEXT_WINDOWS_KEPT],
  )
}

/** The last window of each session, oldest first. */
export async function loadSessionWindows(db: Queryable): Promise<[string, number][]> {
  const { rows } = await db.query<{ session_id: string; window_size: number }>('select session_id, window_size from session_windows order by seen_at, session_id')
  return rows.map((row) => [row.session_id, row.window_size])
}

/** Starts its write at the call: see `Writes`. */
export async function saveSessionWindow(db: Queryable, sessionId: string, window: number, at: number): Promise<void> {
  await db.query(
    `insert into session_windows (session_id, window_size, seen_at) values ($1, $2, $3)
       on conflict (session_id) do update set window_size = excluded.window_size`,
    [sessionId, window, at],
  )
  await db.query(
    'delete from session_windows where session_id in (select session_id from session_windows order by seen_at desc, session_id desc offset $1)',
    [SESSION_WINDOWS_KEPT],
  )
}
