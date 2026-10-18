import { readFile } from 'node:fs/promises'
import type { DatabaseSync } from 'node:sqlite'
import type { HandoffReason } from './prompts.js'

const NOTE_LIMIT = 512 * 1024

export type SnapshotReason = 'relay' | 'restart' | 'checkpoint'

/** What a handoff gave the new session, kept for Tally: the note gets overwritten by the next handoff and goes with the worktree. */
export interface HandoffSnapshot {
  at: string
  task: string
  sessionId: string
  previous: string
  reason: SnapshotReason
  prompt: string
  notePath: string | null
  note: string | null
}

/** The launch journal's word for the handoff reason. */
export function snapshotReason(reason: HandoffReason): SnapshotReason {
  return reason === 'limit' || reason === 'mainFixed' ? 'relay' : reason
}

export async function readNote(path: string | null): Promise<string | null> {
  if (path === null) return null
  try {
    const text = await readFile(path, 'utf8')
    return text.length > NOTE_LIMIT ? text.slice(0, NOTE_LIMIT) : text
  } catch {
    return null
  }
}

export function saveSnapshot(db: DatabaseSync, snapshot: HandoffSnapshot): void {
  const { at, task, sessionId, previous, reason, prompt, notePath, note } = snapshot
  db.prepare(
    'INSERT OR REPLACE INTO handoffs (session_id, at, task, previous, reason, prompt, note_path, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(sessionId, at ?? null, task ?? null, previous ?? null, reason ?? null, prompt ?? null, notePath ?? null, note ?? null)
}

/** The saved snapshots, oldest first; a snapshot imported from an older file may lack fields. */
export function readSnapshots(db: DatabaseSync): HandoffSnapshot[] {
  const rows = db.prepare('SELECT session_id, at, task, previous, reason, prompt, note_path, note FROM handoffs ORDER BY at, rowid').all() as Record<string, string | null>[]
  return rows.map((row) => ({
    at: row.at!,
    task: row.task!,
    sessionId: row.session_id!,
    previous: row.previous!,
    reason: row.reason as SnapshotReason,
    prompt: row.prompt!,
    notePath: row.note_path!,
    note: row.note!,
  }))
}
