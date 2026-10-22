import { existsSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { databaseFile } from './home.js'
import type { MessageRow, PartRow } from './transcript.js'

/**
 * Reads of an account's `opencode.db` (SQLite in WAL mode, written by every OpenCode process of the account): each read
 * opens the file read-only and closes it at once, so Even Keel never holds it. A tool's output and metadata are left
 * in the file: the feed needs neither, and they make most of a part's size.
 */
export interface SessionRows {
  messages: MessageRow[]
  parts: PartRow[]
  /** The last change of any row: the transcript is read again only when it moves. */
  stamp: number
}

export interface SessionInfo {
  id: string
  title: string
  directory: string
  createdAt: number
}

const PART_DATA = `json_remove(data, '$.state.output', '$.state.metadata', '$.state.attachments')`

export async function sessionRows(dir: string, sessionId: string): Promise<SessionRows | undefined> {
  return withDatabase(dir, (db) => {
    const found = db.prepare('select 1 from session where id = ?').get(sessionId)
    if (found === undefined) return undefined
    const messages = db
      .prepare('select id, time_created as at, data from message where session_id = ? order by time_created, id')
      .all(sessionId) as unknown as MessageRow[]
    const parts = db
      .prepare(`select id, message_id as message, time_created as at, ${PART_DATA} as data from part where session_id = ? order by id`)
      .all(sessionId) as unknown as PartRow[]
    return { messages, parts, stamp: stampOf(db, sessionId) }
  })
}

/** When the session's rows last changed; `undefined` — the folder has no such session. */
export async function sessionStamp(dir: string, sessionId: string): Promise<number | undefined> {
  return withDatabase(dir, (db) => (db.prepare('select 1 from session where id = ?').get(sessionId) === undefined ? undefined : stampOf(db, sessionId)))
}

/** The account's sessions, newest first; subagents' sessions (`parent_id`) are left out. */
export async function sessionList(dir: string): Promise<SessionInfo[]> {
  return (
    (await withDatabase(
      dir,
      (db) =>
        db
          .prepare('select id, title, directory, time_created as createdAt from session where parent_id is null order by time_created desc')
          .all() as unknown as SessionInfo[],
    )) ?? []
  )
}

/** A response of the model with its session, as Tally counts it: the message's own JSON holds the tokens and the model. */
export interface ResponseRow {
  id: string
  session: string
  /** The session that started this one as a subagent; `null` for a session of its own. */
  parent: string | null
  title: string
  at: number
  data: string
}

/** Every response in the account's `opencode.db` file; `undefined` when it cannot be read. */
export async function responseRows(file: string): Promise<ResponseRow[] | undefined> {
  return withFile(
    file,
    (db) =>
      db
        .prepare(
          `select m.id, m.session_id as session, s.parent_id as parent, s.title, m.time_created as at, m.data
             from message m join session s on s.id = m.session_id
            where json_extract(m.data, '$.role') = 'assistant'`,
        )
        .all() as unknown as ResponseRow[],
  )
}

function stampOf(db: DatabaseSync, sessionId: string): number {
  const row = db
    .prepare(
      `select max(stamp) as stamp from (
         select max(time_updated) as stamp from message where session_id = ?
         union all select max(time_updated) from part where session_id = ?
         union all select time_updated from session where id = ?)`,
    )
    .get(sessionId, sessionId, sessionId) as { stamp: number | null } | undefined
  return row?.stamp ?? 0
}

function withDatabase<T>(dir: string, read: (db: DatabaseSync) => T): Promise<T | undefined> {
  return withFile(databaseFile(dir), read)
}

async function withFile<T>(file: string, read: (db: DatabaseSync) => T): Promise<T | undefined> {
  if (!existsSync(file)) return undefined
  const { DatabaseSync } = await import('node:sqlite')
  let db: DatabaseSync | undefined
  try {
    db = new DatabaseSync(file, { readOnly: true })
    return read(db)
  } catch {
    return undefined
  } finally {
    db?.close()
  }
}
