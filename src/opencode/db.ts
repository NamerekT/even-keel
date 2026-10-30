import { existsSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import type { TranscriptImage } from '../sessions/entry.js'
import { databaseFile } from './home.js'
import type { MessageRow, PartRow } from './transcript.js'

/**
 * Reads of an account's `opencode.db` (SQLite in WAL mode, written by every OpenCode process of the account): each read
 * opens the file read-only and closes it at once, so Even Keel never holds it. A tool's output and metadata are left
 * in the file: the feed needs neither, and they make most of a part's size. Only the chat's message the `checkpoint`
 * package's plugin kept in the metadata, `evenKeel.mail`, and a count of image attachments are read. Images themselves
 * are read separately by session and call id, without depending on the original file.
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

const MAIL = `json_extract(data, '$.state.metadata.evenKeel.mail')`
const STRIPPED = `json_remove(data, '$.state.output', '$.state.metadata', '$.state.attachments')`
const PART_DATA = `case when ${MAIL} is null then ${STRIPPED}
  else json_set(${STRIPPED}, '$.state.metadata', json_object('evenKeel', json_object('mail', ${MAIL}))) end`
const IMAGE_TYPE = `json_extract(attachment.value, '$.mime')`
const IMAGE_URL = `json_extract(attachment.value, '$.url')`
const IMAGE_HEADER = `('data:' || ${IMAGE_TYPE} || ';base64,')`
const IMAGE_WHERE = `attachment.type = 'object'
  and json_extract(part.data, '$.type') = 'tool'
  and json_extract(attachment.value, '$.type') = 'file'
  and ${IMAGE_TYPE} like 'image/%'
  and substr(${IMAGE_URL}, 1, length(${IMAGE_HEADER})) = ${IMAGE_HEADER}
  and length(${IMAGE_URL}) > length(${IMAGE_HEADER})`
const IMAGE_COUNT = `(select count(*) from json_each(part.data, '$.state.attachments') as attachment where ${IMAGE_WHERE})`

export async function sessionRows(dir: string, sessionId: string): Promise<SessionRows | undefined> {
  return withDatabase(dir, (db) => {
    const found = db.prepare('select 1 from session where id = ?').get(sessionId)
    if (found === undefined) return undefined
    const messages = db
      .prepare('select id, time_created as at, data from message where session_id = ? order by time_created, id')
      .all(sessionId) as unknown as MessageRow[]
    const parts = db
      .prepare(`select id, message_id as message, time_created as at, ${PART_DATA} as data, ${IMAGE_COUNT} as images from part where session_id = ? order by id`)
      .all(sessionId) as unknown as PartRow[]
    return { messages, parts, stamp: stampOf(db, sessionId) }
  })
}

/** Picture `index` of a tool result, kept in OpenCode's database after its source file is gone. */
export async function sessionImage(dir: string, sessionId: string, tool: string, index: number): Promise<TranscriptImage | undefined> {
  if (!Number.isInteger(index) || index < 0) return undefined
  return withDatabase(dir, (db) => db.prepare(
    `select ${IMAGE_TYPE} as type, substr(${IMAGE_URL}, length(${IMAGE_HEADER}) + 1) as data
       from part, json_each(part.data, '$.state.attachments') as attachment
      where part.session_id = ? and json_extract(part.data, '$.callID') = ? and ${IMAGE_WHERE}
      order by part.id, attachment.key limit 1 offset ?`,
  ).get(sessionId, tool, index) as TranscriptImage | undefined)
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

/** A message of a session or of its subagent (`sub` 1), as Tally splits the session into turns. */
export interface TurnRow {
  id: string
  sub: number
  at: number
  /** The message's JSON without its summary, system prompt, tools and path. */
  data: string
  /** A user message's own text parts; `null` for a response or a message with none, such as a compaction's. */
  text: string | null
}

/** The ids of the file's sessions, subagents' left out; `undefined` when it cannot be read. */
export async function topSessions(file: string): Promise<string[] | undefined> {
  return withFile(file, (db) => (db.prepare('select id from session where parent_id is null').all() as { id: string }[]).map((row) => row.id))
}

/** The messages of a session and of its subagents in time order; `undefined` when the file cannot be read. */
export async function turnRows(file: string, sessionId: string): Promise<TurnRow[] | undefined> {
  return withFile(
    file,
    (db) =>
      db
        .prepare(
          `select m.id, (m.session_id <> ?) as sub, m.time_created as at,
                  json_remove(m.data, '$.summary', '$.system', '$.tools', '$.path') as data,
                  case when json_extract(m.data, '$.role') = 'user' then (
                    select group_concat(text, char(10)) from (
                      select json_extract(p.data, '$.text') as text from part p
                       where p.message_id = m.id and json_extract(p.data, '$.type') = 'text' order by p.id)) end as text
             from message m
            where m.session_id = ? or m.session_id in (select id from session where parent_id = ?)
            order by m.time_created, m.id`,
        )
        .all(sessionId, sessionId, sessionId) as unknown as TurnRow[],
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
