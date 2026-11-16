import type { HandoffNote, NoteRefusal } from '../chain/handoff-note.js'
import { EditRefused } from '../tracker/editor.js'
import type { TasksScope } from './calls.js'

export const NOTE_KEPT = 'The handoff note is kept. End your turn with a last line CHECKPOINT: alone; Even Keel hands the task to a fresh session with this note.'

const REFUSED: Record<NoteRefusal, (task: string) => string> = {
  notLaunched: (task) => `Even Keel did not start this session for ${task}: it keeps no handoff note of it. Do not repeat the call.`,
  stale: (task) =>
    `This session is no longer the current session of ${task}: Even Keel handed the task to another one, so this note is not kept. Do not repeat the call; stop working on the task.`,
}

/**
 * `handoff_write` (BTN-1046): the hub keeps the note of the call's task, from the session the machine named when the
 * call was made, and refuses a session that is no longer the task's current one.
 */
export async function handoffWrite(text: string, scope: TasksScope, write: ((note: HandoffNote) => Promise<NoteRefusal | null>) | undefined): Promise<string> {
  if (scope.project === null || scope.task === null || write === undefined) throw new EditRefused('handoff_write is only for a chain session of Even Keel: it keeps the note of its own task')
  const writer = scope.writer
  if (writer === undefined) throw new EditRefused(`Even Keel could not tell which session of ${scope.task} made this call, so the note is not kept`)
  const refusal = await write({ project: scope.project, task: scope.task, sessionId: writer.session, branch: writer.branch, machine: scope.machine ?? null, at: writer.at, note: text })
  if (refusal !== null) throw new EditRefused(REFUSED[refusal](scope.task))
  return NOTE_KEPT
}
