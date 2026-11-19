import type { Queryable } from '../../src/storage/database.js'

/** A project chat's session (BTN-1229): a session without a task, counted apart from the tasks (BTN-1233). */
export interface ChatSession {
  session: string
  chat: string
}

const CHATS = `select session_id as session, id as chat from chats where session_id is not null order by id`

/** The session of every chat of Even Keel's state database, archived ones too; a database before step 63 has none. */
export async function chatSessions(db: Queryable): Promise<ChatSession[]> {
  const { rows } = await db.query<ChatSession>(CHATS).catch(() => ({ rows: [] as ChatSession[] }))
  return rows.map((row) => ({ session: row.session, chat: row.chat }))
}

/**
 * $1 — `ChatSession[]`. Each link is kept: a chat keeps only its latest session, and the one before it, or a chat that
 * went with its project, stays a chat's.
 */
export const CHAT_SESSIONS = `
insert into chat_sessions (session_id, chat)
select session, chat from jsonb_to_recordset($1::jsonb) as x(session text, chat text)
on conflict (session_id) do update set chat = excluded.chat where chat_sessions.chat is distinct from excluded.chat`
