import type { Db, Queryable } from '../storage/database.js'
import type { HandoffNote, NoteRefusal } from './handoff-note.js'
import type { HandoffSnapshot } from './snapshots.js'

export { noteFrom, type HandoffNote, type NoteRefusal, type NoteText } from './handoff-note.js'

/** Past this a note is cut: a note is a page of text, not a dump. */
export const HANDOFF_NOTE_LIMIT = 512 * 1024

/**
 * The session the hub's launch journal names last for the task: the only one whose note the hub keeps, so that a late
 * write of a session already handed over (one kept on the machine while the hub was away) never replaces the note of
 * the session after it.
 */
async function currentSession(db: Queryable, project: string, task: string): Promise<string | undefined> {
  const { rows } = await db.query<{ session_id: string }>(
    'select session_id from launches where project_id = $1 and task = $2 order by id desc limit 1',
    [project, task],
  )
  return rows[0]?.session_id
}

/** Keeps a note the session wrote; a session that is not the task's current one is refused, and nothing is kept. */
export async function writeHandoffNote(db: Db, note: HandoffNote): Promise<NoteRefusal | null> {
  const current = await currentSession(db, note.project, note.task)
  if (current === undefined) return 'notLaunched'
  if (current !== note.sessionId) return 'stale'
  await keepHandoffNote(db, note)
  return null
}

/** Keeps a note without asking the journal: the machine read it from the folder of the session it hands over. */
export async function keepHandoffNote(db: Db, note: HandoffNote): Promise<void> {
  const text = note.note.length > HANDOFF_NOTE_LIMIT ? note.note.slice(0, HANDOFF_NOTE_LIMIT) : note.note
  await db.query(
    'insert into handoff_notes (project_id, task, session_id, branch, machine_id, at, note) values ($1, $2, $3, $4, $5, $6, $7)',
    [note.project, note.task, note.sessionId, note.branch, note.machine, note.at, text],
  )
}

/** The task's newest note; `undefined` — none was written. */
export async function lastHandoffNote(db: Queryable, project: string, task: string): Promise<HandoffNote | undefined> {
  const { rows } = await db.query<{ session_id: string; branch: string | null; machine_id: string | null; at: string; note: string }>(
    'select session_id, branch, machine_id, at, note from handoff_notes where project_id = $1 and task = $2 order by id desc limit 1',
    [project, task],
  )
  const row = rows[0]
  if (row === undefined) return undefined
  return { project, task, sessionId: row.session_id, branch: row.branch, machine: row.machine_id, at: row.at, note: row.note }
}

/**
 * The note file an older session wrote (`CHECKPOINT: <path>`), as the machine read it at the handoff and sent it with
 * the snapshot: the hub keeps it as that session's note. `undefined` — the handoff read no file.
 */
export function fileNote(snapshot: HandoffSnapshot, project: string | undefined, machine: string | null): HandoffNote | undefined {
  if (project === undefined || snapshot.notePath === null || snapshot.note === null || snapshot.note.trim() === '') return undefined
  return { project, task: snapshot.task, sessionId: snapshot.previous, branch: null, machine, at: snapshot.at, note: snapshot.note }
}
