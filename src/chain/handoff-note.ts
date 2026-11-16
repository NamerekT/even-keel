// The handoff note's model without the database: the machine's moves import it, and the page's build reaches them.

/**
 * A handoff note as the hub keeps it (BTN-1046, `docs/sessions/checkpoint.md`, "The note kept with Even Keel"): written
 * by a task's session through the tasks server's `handoff_write`, or read by the machine from the note file of an older
 * session at its handoff. Kept by `src/chain/handoff-notes.ts`.
 */
export interface HandoffNote {
  project: string
  task: string
  sessionId: string
  branch: string | null
  machine: string | null
  /** When the session wrote it (ISO), not when the hub took it: a write kept on the machine arrives later. */
  at: string
  note: string
}

/** What a handoff needs of the task's note: who wrote it and the text. */
export type NoteText = Pick<HandoffNote, 'sessionId' | 'at' | 'note'>

/** Why the hub did not keep a note. */
export type NoteRefusal = 'notLaunched' | 'stale'

/** The note a handoff from `sessionId` carries: the task's newest one, only when that session wrote it. */
export function noteFrom(note: NoteText | undefined, sessionId: string): string | null {
  return note !== undefined && note.sessionId === sessionId && note.note.trim() !== '' ? note.note : null
}
